/**
 * Orchestrator turn engine — core of Phase 3 agent scheduling.
 *
 * Consumes jobs from the `conv-events` BullMQ queue (bridged from Redis
 * pub/sub `conv.node.appended:{projectId}`).
 *
 * Per-job logic:
 *   1. Zod-validate payload; malformed → DLQ + log, consumer keeps running.
 *   2. Budget guard: agents_paused check + daily USD circuit breaker.
 *   3. Load room roster + room type from DB.
 *   4. Load last k=6 ancestors from DB (for recency fatigue / ownership).
 *   5. Load per-agent working memories.
 *   6. scoreAgents() → score each roster member.
 *   7. applyTurnPolicy() → prune to speaker set.
 *   8. turn_depth ≥ 4 with agent trigger → stop (convergence guard).
 *   9. Enqueue BullMQ agent-turns jobs with per-conversation concurrency group ≤3.
 *  10. Working-memory upkeep: extractFacts + detectOpenLoops + updateWorkingMemory
 *      for ALL roster agents (not just speakers).
 *  11. checkSummaryThreshold → enqueue housekeeping job if needed.
 *
 * Security:
 *   - Engine runs as SYSTEM_USER_ID identity (RLS project isolation).
 *   - Text inputs capped at 8192 chars before pattern matching (via relevance.ts).
 *   - Poison messages → DLQ; no re-throw keeps the Worker alive.
 *
 * Dependency injection: all I/O is passed via TurnEngineDeps so tests can
 * mock individual calls without spinning up Redis/Postgres.
 */

import { z } from 'zod'
import type { Redis } from 'ioredis'
import { scoreAgents } from '../pa/relevance.js'
import { applyTurnPolicy } from './turn-policies.js'
import type { RoomType } from './turn-policies.js'
import {
  extractFacts,
  detectOpenLoops,
  closeLoops,
  updateWorkingMemory,
  type WorkingMemory,
} from '../pa/working-memory.js'
import { checkSummaryThreshold, type SummaryJobPayload } from '../pa/summarizer.js'
import type { ThreadNode } from '../pa/context-bundle.js'
import type { ScoringAgent, ScoringNode } from '../pa/relevance.js'
import { checkBudgetGuard, type DailyUsdChecker } from './budget-guard.js'

// ── Turn depth cap ─────────────────────────────────────────────────────────────

/** Max agent→agent hops before the conversation chain is cut off. */
const MAX_TURN_DEPTH = 4

/** Max speakers enqueued per turn (mirrors turn-policies constant). */
const MAX_SPEAKERS = 3

// ── Job data schema ─────────────────────────────────────────────────────────────

export const ConvEventJobDataSchema = z.object({
  /** Must match the event published by the event bus bridge. */
  event: z.literal('conv.node.appended'),
  projectId: z.string().uuid(),
  conversationId: z.string().uuid(),
  nodeId: z.string().uuid(),
  roomId: z.string().uuid(),
  /** 'user' | 'agent' | 'system' */
  authorKind: z.enum(['user', 'agent', 'system']),
  authorPersonaId: z.string().uuid().optional(),
  /**
   * Number of agent→agent hops on this branch so far.
   * 0 for user-originated messages.
   */
  turnDepth: z.number().int().nonnegative(),
  /** Extracted from node.content.text */
  nodeText: z.string(),
  /** Pre-computed embedding (may be absent if embedder hasn't run yet). */
  nodeEmbedding: z.array(z.number()).optional(),
})

export type ConvEventJobData = z.infer<typeof ConvEventJobDataSchema>

// ── Agent-turns job payload ────────────────────────────────────────────────────

export interface AgentTurnJobData {
  projectId: string
  conversationId: string
  /** Branch the agent should reply on. */
  branchId: string
  triggerNodeId: string
  personaId: string
  turnDepth: number
  triggerReason: 'mention' | 'expertise' | 'follow-up'
  /** Display names of co-speakers this turn (for context instruction). */
  otherSpeakers: string[]
  /** When true, turn engine bypasses normal score threshold and always enqueues this agent. */
  forceSummon?: boolean
}

// ── Housekeeping job payload ───────────────────────────────────────────────────

export type HousekeepingJobData = SummaryJobPayload

// ── Roster types (returned by loadRosterAndRoom dep) ─────────────────────────

export interface RosterAgent {
  personaId: string
  slug: string
  name: string
  title: string
  expertiseTags: string[]
  speakProfile: {
    eagerness: number
    interruptThreshold: number
    silenceBias: number
  }
}

export interface RoomWithRoster {
  /** Room type drives the turn policy. */
  roomType: string
  /** Conversation's default branch — used as branchId in agent-turn jobs. */
  defaultBranchId: string | null
  agents: RosterAgent[]
}

// ── Dependency injection interface ────────────────────────────────────────────

/** Minimal queue interface used by the turn engine. */
export interface TurnQueue {
  add: (name: string, data: unknown, opts?: unknown) => Promise<unknown>
}

export interface TurnEngineDeps {
  redis: Redis
  /** Loads room metadata and agent roster for the given room. */
  loadRosterAndRoom: (roomId: string, conversationId: string, projectId: string) => Promise<RoomWithRoster>
  /**
   * Returns the last `limit` conversation nodes before the trigger node
   * (ordered by depth/creation, oldest first — newest last).
   * Used for recency fatigue and thread-ownership scoring.
   */
  loadRecentAncestors: (
    conversationId: string,
    nodeId: string,
    limit: number,
    projectId: string,
  ) => Promise<ScoringNode[]>
  /** Loads existing working memories for the listed persona IDs. Missing = empty. */
  loadWorkingMemories: (
    personaIds: string[],
    conversationId: string,
    projectId: string,
  ) => Promise<Map<string, WorkingMemory>>
  /** Persists (upsert) a working memory record. */
  upsertWorkingMemory: (mem: WorkingMemory) => Promise<void>
  /** Returns total estimated_usd spent today for this project. */
  checkDailyUsd: DailyUsdChecker
  agentTurnsQueue: TurnQueue
  dlqQueue: TurnQueue
  housekeepingQueue: TurnQueue
  /**
   * Optional hook to schedule a proactive check after each node is processed.
   * Wired to the ProactiveScheduler's BullMQ queue in production.
   * Errors are swallowed — a failed proactivity check must never kill the job.
   */
  scheduleProactiveCheck?: (projectId: string) => Promise<void>
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function emptyWorkingMemory(
  personaId: string,
  conversationId: string,
  projectId: string,
): WorkingMemory {
  return {
    personaId,
    conversationId,
    projectId,
    facts: [],
    openLoops: [],
    lastSummaryNode: null,
    summaryMd: null,
    updatedAt: new Date().toISOString(),
  }
}

/**
 * Derive the trigger reason for a speaker from its score breakdown.
 * Mention dominates; expertise next; otherwise follow-up.
 */
function deriveTriggerReason(
  breakdown: { mention: number; expertise: number; lexical: number },
): AgentTurnJobData['triggerReason'] {
  if (breakdown.mention > 0) return 'mention'
  if (breakdown.expertise > 0 || breakdown.lexical > 0.1) return 'expertise'
  return 'follow-up'
}

/**
 * Build a ScoringAgent from a RosterAgent row.
 * expertiseCentroid defaults to [] — embedding lookup is deferred to Phase 4.
 */
function toScoringAgent(agent: RosterAgent): ScoringAgent {
  return {
    personaId: agent.personaId,
    slug: agent.slug,
    name: agent.name,
    expertiseTags: agent.expertiseTags,
    expertiseCentroid: [],
    speakProfile: agent.speakProfile,
  }
}

// ── Core job processor ─────────────────────────────────────────────────────────

/**
 * Process one `conv-events` job.
 *
 * Does NOT throw — on any unrecoverable error the job is moved to the DLQ
 * and the function returns normally so the BullMQ Worker stays alive.
 *
 * @param rawData  Raw BullMQ job data (unvalidated).
 * @param deps     Injected dependencies (Redis, DB loaders, queues).
 */
export async function processTurnJob(
  rawData: unknown,
  deps: TurnEngineDeps,
): Promise<void> {
  // ── 1. Validate job payload ──────────────────────────────────────────────
  const parseResult = ConvEventJobDataSchema.safeParse(rawData)
  if (!parseResult.success) {
    const err = parseResult.error
    await deps.dlqQueue.add('malformed-event', {
      rawData,
      error: err.message,
      ts: new Date().toISOString(),
    })
    console.error('[turn-engine] malformed job payload → DLQ', {
      issues: err.issues,
    })
    return
  }

  const data = parseResult.data

  try {
    const {
      projectId,
      conversationId,
      nodeId,
      roomId,
      authorKind,
      authorPersonaId,
      turnDepth,
      nodeText,
      nodeEmbedding,
    } = data

    // ── 2. Budget guard ────────────────────────────────────────────────────
    const budget = await checkBudgetGuard(projectId, deps.redis, deps.checkDailyUsd)
    if (!budget.allowed) {
      console.info('[turn-engine] budget guard blocked scheduling', {
        projectId,
        reason: budget.reason,
      })
      return
    }

    // ── 3. Load room roster + room type ────────────────────────────────────
    const { roomType, defaultBranchId, agents } = await deps.loadRosterAndRoom(
      roomId,
      conversationId,
      projectId,
    )

    if (agents.length === 0) {
      console.info('[turn-engine] no agents in room roster', { roomId, projectId })
      return
    }

    // ── 4. Load recent ancestors (k=6) ─────────────────────────────────────
    const recentAncestors = await deps.loadRecentAncestors(
      conversationId,
      nodeId,
      6,
      projectId,
    )

    // ── 5. Load working memories ───────────────────────────────────────────
    const personaIds = agents.map((a) => a.personaId)
    const workingMemories = await deps.loadWorkingMemories(
      personaIds,
      conversationId,
      projectId,
    )

    // Build openLoopsPerAgent map for scorer
    const openLoopsPerAgent: Record<string, string[]> = {}
    for (const agent of agents) {
      const mem = workingMemories.get(agent.personaId)
      openLoopsPerAgent[agent.personaId] = mem
        ? mem.openLoops
            .filter((l) => l.closedAt === undefined)
            .map((l) => l.text)
        : []
    }

    // ── 6. Score agents ────────────────────────────────────────────────────
    const triggerNode: ScoringNode = {
      nodeId,
      text: nodeText,
      type: authorKind === 'user' ? 'user_message' : 'agent_message',
      authorPersonaId: authorPersonaId ?? null,
      embedding: nodeEmbedding ?? [],
    }

    const scoringAgents = agents.map(toScoringAgent)
    const scored = scoreAgents(scoringAgents, {
      node: triggerNode,
      recentAncestors,
      openLoopsPerAgent,
    })

    // ── 7. Apply turn policy ───────────────────────────────────────────────
    const triggerKind = authorKind === 'agent' ? 'agent' : 'user'
    const { speakers } = applyTurnPolicy({
      scores: scored,
      roomType: roomType as RoomType,
      triggerKind,
      turnDepth,
    })

    // ── 8. Convergence guard: depth ≥ 4 with agent trigger → stop ─────────
    if (authorKind === 'agent' && turnDepth >= MAX_TURN_DEPTH) {
      console.info('[turn-engine] depth cap reached — stopping chain', {
        conversationId,
        turnDepth,
      })
      // Still run working-memory upkeep (steps 10–11) below — fall through
    } else if (speakers.length > 0) {
      // ── 9. Enqueue agent-turn jobs ─────────────────────────────────────
      const branchId = defaultBranchId ?? conversationId // fallback if no branch yet
      const capped = speakers.slice(0, MAX_SPEAKERS)
      const otherSpeakerNames = capped.map((s) => s.agent.name)

      for (const speakerScore of capped) {
        const otherSpeakers = otherSpeakerNames.filter(
          (n) => n !== speakerScore.agent.name,
        )
        const jobData: AgentTurnJobData = {
          projectId,
          conversationId,
          branchId,
          triggerNodeId: nodeId,
          personaId: speakerScore.agent.personaId,
          turnDepth: turnDepth + 1,
          triggerReason: deriveTriggerReason(speakerScore.breakdown),
          otherSpeakers,
        }

        // Deterministic job ID for deduplication: same persona+conv+node → same job ID.
        // BullMQ ignores the second enqueue if a job with this ID already exists
        // (pending or active), providing idempotent replay safety on Redis failover.
        const jobId = `agent-turn:${speakerScore.agent.personaId}:${conversationId}:${nodeId}`

        await deps.agentTurnsQueue.add('agent-turn', jobData, {
          jobId,
          // Per-conversation concurrency group (≤3 concurrent agents per conv).
          // Requires BullMQ Pro in production; mocked in tests.
          group: {
            id: `conv:${conversationId}`,
            concurrency: 3,
          },
        })
      }
    }

    // ── 10. Working-memory upkeep (ALL roster agents) ──────────────────────
    for (const agent of agents) {
      const existing =
        workingMemories.get(agent.personaId) ??
        emptyWorkingMemory(agent.personaId, conversationId, projectId)

      const newFacts = extractFacts(nodeText, nodeId, agent.name, agent.title)
      const newLoops = detectOpenLoops(nodeText, nodeId, agent.slug, roomType)
      const closedIds = closeLoops(nodeText, existing.openLoops)

      const updated = updateWorkingMemory(existing, newFacts, newLoops, closedIds)
      await deps.upsertWorkingMemory(updated)
    }

    // ── 11. Summary threshold check ────────────────────────────────────────
    // Build a minimal ThreadNode list from ancestors + trigger node
    const threadNodes: ThreadNode[] = [
      ...recentAncestors.map((n) => ({
        nodeId: n.nodeId,
        authorKind: (n.authorPersonaId !== null ? 'agent' : 'user') as ThreadNode['authorKind'],
        authorName: n.authorPersonaId ?? 'user',
        text: n.text,
        type: n.type,
      })),
      {
        nodeId,
        authorKind: authorKind as ThreadNode['authorKind'],
        authorName: authorPersonaId ?? 'user',
        text: nodeText,
        type: triggerNode.type,
      },
    ]

    // Use the first agent's lastSummaryNode as a representative check
    const firstAgent = agents[0]
    const firstMem = firstAgent
      ? (workingMemories.get(firstAgent.personaId) ??
          emptyWorkingMemory(firstAgent.personaId, conversationId, projectId))
      : null

    if (firstMem) {
      const summaryCheck = checkSummaryThreshold(
        threadNodes,
        firstMem.lastSummaryNode,
        conversationId,
        defaultBranchId ?? conversationId,
        projectId,
      )
      if (summaryCheck.shouldSummarize && summaryCheck.jobPayload) {
        await deps.housekeepingQueue.add('summarize', summaryCheck.jobPayload)
      }
    }

    // ── 12. Proactivity scheduling hook ───────────────────────────────────────
    // Fire-and-forget: errors are swallowed so a failed check never kills the job.
    if (deps.scheduleProactiveCheck) {
      await deps.scheduleProactiveCheck(projectId).catch((err) => {
        console.warn('[turn-engine] proactive_check.schedule_failed', { err: String(err) })
      })
    }
  } catch (err) {
    // Poison-message handling: unexpected errors go to DLQ; Worker keeps running.
    await deps.dlqQueue.add('processing-error', {
      rawData,
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
      ts: new Date().toISOString(),
    })
    console.error('[turn-engine] unexpected error processing job → DLQ', { err })
  }
}
