/**
 * Interrupts & summons engine — T3.3.4.
 *
 * Handles three interrupt types (04_agent_orchestration_spec.md §5.1/5.2):
 *   stop     → set Redis flag + drain BullMQ queue + emit agent.interrupted
 *   redirect → stop-all + mark branch abandoned + fork new branch + emit conv.branch.forked
 *   summon   → enqueue agent-turn with forceSummon=true + emit agent.summoned
 *
 * Also exports:
 *   checkInterrupt          — inter-node interrupt check for the agent graph
 *   checkInterjectThreshold — Turn Engine interjection helper
 *   InterruptedError        — thrown by agent graph on interrupt; BullMQ marks job failed
 *
 * Authorization (non-negotiable):
 *   stop/redirect → raisedBy.kind === 'user' AND project member
 *   summon        → project member (user) OR room member (csuite agent)
 *   Unauthorized  → log + emit interrupt.rejected; never throw
 *
 * Dependency injection: all I/O injected via InterruptDeps so tests mock without
 * spinning up Redis/Postgres/BullMQ.
 */

import { z } from 'zod'
import type { Redis } from 'ioredis'
import type { AgentScore } from '../pa/relevance.js'

// ── Constants ──────────────────────────────────────────────────────────────────

/** TTL for Redis interrupt-stop flags. Auto-clears once the agent finishes. */
export const INTERRUPT_TTL_SEC = 30

/**
 * Minimum score advantage above the lowest current speaker for interjection.
 * See 04-doc §5.1: agent judges it must interject based on speak_profile.eagerness
 * and score above interrupt_threshold on ANOTHER agent's streaming message.
 */
export const INTERJECT_DELTA = 0.8

// ── Zod schema (used at event-bus subscriber boundary) ────────────────────────

export const InterruptEventSchema = z.object({
  reason: z.enum(['stop', 'redirect', 'summon']),
  conversationId: z.string().uuid(),
  projectId: z.string().uuid(),
  raisedBy: z.object({ kind: z.enum(['user', 'agent']), id: z.string().uuid() }),
  personaId: z.string().uuid().optional(),
  branchId: z.string().uuid().optional(),
})

// ── Types ──────────────────────────────────────────────────────────────────────

export type InterruptReason = 'stop' | 'redirect' | 'summon'

export interface InterruptEvent {
  reason: InterruptReason
  conversationId: string
  projectId: string
  raisedBy: { kind: 'user' | 'agent'; id: string }
  /**
   * For stop: undefined = stop ALL agents on this conversation.
   * For summon: the personaId to call in.
   */
  personaId?: string
  /** For redirect: the branchId to archive. */
  branchId?: string
}

export interface InterruptDeps {
  redis: Redis
  agentTurnsQueue: {
    add: (name: string, data: unknown, opts?: unknown) => Promise<unknown>
    /**
     * Drain all waiting jobs from the queue.
     * Production: use BullMQ Pro `queue.drainGroup(\`conv:${conversationId}\`)` for
     * per-conversation precision. The queue interface abstracts this detail.
     */
    drain: (delayed?: boolean) => Promise<void>
  }
  /** Publish on the event bus (EventPublisher.publish equivalent). */
  publishEvent: (channel: string, payload: unknown) => Promise<void>
  /** Return true if userId is a member (any role) of projectId. */
  checkProjectMember: (userId: string, projectId: string) => Promise<boolean>
  /**
   * Return true if personaId is in the room roster for this conversation.
   * Used to authorise csuite-agent summons.
   */
  checkRoomMembership: (
    personaId: string,
    conversationId: string,
    projectId: string,
  ) => Promise<boolean>
  /**
   * Mark a branch as abandoned (spec says 'archived'; DB constraint uses 'abandoned').
   * Called during redirect to retire the current branch.
   */
  archiveBranch: (branchId: string, projectId: string) => Promise<void>
  /** Insert a new branch forked from the given node. */
  createBranch: (params: {
    conversationId: string
    projectId: string
    forkedFromNodeId: string
    createdByKind: string
    createdById: string
  }) => Promise<{ id: string; name: string; headNodeId: string; createdAt: string }>
  /**
   * Return the conversation's current head node and its room ID.
   * Used as the fork point for redirect and the trigger node for summon.
   */
  getConversationHeadNode: (
    conversationId: string,
    projectId: string,
  ) => Promise<{ nodeId: string; roomId: string; branchId: string | null } | null>
  /** Write a structured audit log entry. */
  auditLog: (entry: {
    action: string
    projectId: string
    actorKind: string
    actorId: string
    meta: unknown
  }) => Promise<void>
}

// ── Errors ─────────────────────────────────────────────────────────────────────

/**
 * Thrown by the agent graph when it detects a Redis interrupt flag between nodes.
 * BullMQ catches this and marks the job as failed (no retry).
 */
export class InterruptedError extends Error {
  public readonly conversationId: string
  public readonly personaId: string

  constructor(conversationId: string, personaId: string) {
    super(`Agent turn interrupted: conv=${conversationId} persona=${personaId}`)
    this.name = 'InterruptedError'
    this.conversationId = conversationId
    this.personaId = personaId
  }
}

// ── Redis helpers ──────────────────────────────────────────────────────────────

/**
 * Check whether a Redis interrupt-stop flag is set for the given agent.
 *
 * Checks TWO keys:
 *   interrupt:stop:{conversationId}:{personaId}  — per-agent stop
 *   interrupt:stop:{conversationId}:*            — stop-all for this conversation
 *
 * Called by the agent graph between every node (04-doc §5.2 checkpoint-yield protocol).
 */
export async function checkInterrupt(
  conversationId: string,
  personaId: string,
  redis: Redis,
): Promise<{ interrupted: boolean }> {
  const specificKey = `interrupt:stop:${conversationId}:${personaId}`
  const wildcardKey = `interrupt:stop:${conversationId}:*`

  const [specific, wildcard] = await Promise.all([
    redis.exists(specificKey),
    redis.exists(wildcardKey),
  ])

  return { interrupted: specific > 0 || wildcard > 0 }
}

// ── Interjection threshold ─────────────────────────────────────────────────────

/**
 * Return personaIds of non-speaking agents whose score is high enough to interject.
 *
 * Only applies to `meeting` and `conference` rooms — `call` rooms never interject.
 *
 * Interjection condition (04-doc §5.1):
 *   agent.score > lowestCurrentSpeakerScore + INTERJECT_DELTA (0.8)
 *
 * Called from the Turn Engine after the speaker set is resolved.
 */
export function checkInterjectThreshold(
  agentScores: AgentScore[],
  currentSpeakers: AgentScore[],
  roomType: string,
): string[] {
  if (roomType === 'call') return []
  if (currentSpeakers.length === 0) return []

  const lowestSpeakerScore = Math.min(...currentSpeakers.map((s) => s.score))
  const speakerIds = new Set(currentSpeakers.map((s) => s.agent.personaId))

  return agentScores
    .filter((s) => !speakerIds.has(s.agent.personaId))
    .filter((s) => s.score > lowestSpeakerScore + INTERJECT_DELTA)
    .map((s) => s.agent.personaId)
}

// ── Internal authorization helpers ─────────────────────────────────────────────

async function isStopAuthorized(
  event: InterruptEvent,
  deps: InterruptDeps,
): Promise<boolean> {
  // Stop and redirect MUST be raised by a user (04-doc §5.1)
  if (event.raisedBy.kind !== 'user') return false
  return deps.checkProjectMember(event.raisedBy.id, event.projectId)
}

async function isSummonAuthorized(
  event: InterruptEvent,
  deps: InterruptDeps,
): Promise<boolean> {
  if (event.raisedBy.kind === 'user') {
    return deps.checkProjectMember(event.raisedBy.id, event.projectId)
  }
  // csuite agents: must be in the room roster
  return deps.checkRoomMembership(
    event.raisedBy.id,
    event.conversationId,
    event.projectId,
  )
}

/** Emit interrupt.rejected event and log. Never throws. */
async function rejectInterrupt(
  event: InterruptEvent,
  deps: InterruptDeps,
  rejectionReason: string,
): Promise<void> {
  console.error('[interrupts] interrupt rejected', {
    reason: event.reason,
    conversationId: event.conversationId,
    raisedBy: event.raisedBy,
    rejectionReason,
  })
  await deps
    .publishEvent(`interrupt.rejected:${event.projectId}`, {
      projectId: event.projectId,
      conversationId: event.conversationId,
      interruptReason: event.reason,
      raisedBy: event.raisedBy,
      rejectionReason,
      ts: new Date().toISOString(),
    })
    .catch((err: unknown) => {
      console.error('[interrupts] failed to emit interrupt.rejected', { err })
    })
}

// ── Stop handler ───────────────────────────────────────────────────────────────

async function handleStop(event: InterruptEvent, deps: InterruptDeps): Promise<void> {
  const { conversationId, projectId, personaId } = event

  // 1. Set Redis interrupt flag (TTL 30 s — auto-clears when agent finishes)
  const redisKey =
    personaId != null
      ? `interrupt:stop:${conversationId}:${personaId}`
      : `interrupt:stop:${conversationId}:*`

  await deps.redis.set(redisKey, '1', 'EX', INTERRUPT_TTL_SEC)

  // 2. Drain pending agent-turn jobs for this conversation.
  //    Production: swap for queue.drainGroup(`conv:${conversationId}`) with BullMQ Pro.
  await deps.agentTurnsQueue.drain()

  // 3. Emit agent.interrupted
  await deps
    .publishEvent(`agent.interrupted:${projectId}`, {
      projectId,
      conversationId,
      personaId: personaId ?? null,
      raisedBy: event.raisedBy,
      ts: new Date().toISOString(),
    })
    .catch((err: unknown) => {
      console.error('[interrupts] failed to emit agent.interrupted', { err })
    })
}

// ── Redirect handler ───────────────────────────────────────────────────────────

async function handleRedirect(event: InterruptEvent, deps: InterruptDeps): Promise<void> {
  const { conversationId, projectId, branchId, raisedBy } = event

  // 1. Stop all agents (same as stop-all: omit personaId to target all agents)
  const stopAllEvent: InterruptEvent = {
    reason: 'stop',
    conversationId: event.conversationId,
    projectId: event.projectId,
    raisedBy: event.raisedBy,
    // personaId intentionally omitted → wildcard Redis key (stop all)
  }
  await handleStop(stopAllEvent, deps)

  // 2. Archive (abandon) the current branch
  if (branchId) {
    await deps.archiveBranch(branchId, projectId)
  } else {
    console.warn('[interrupts] redirect: no branchId supplied — branch archive skipped', {
      conversationId,
    })
  }

  // 3. Fork new branch from the conversation's current head node
  const head = await deps.getConversationHeadNode(conversationId, projectId)
  if (!head) {
    console.error('[interrupts] redirect: conversation head node not found', {
      conversationId,
    })
    return
  }

  const newBranch = await deps.createBranch({
    conversationId,
    projectId,
    forkedFromNodeId: head.nodeId,
    createdByKind: raisedBy.kind,
    createdById: raisedBy.id,
  })

  // 4. Emit conv.branch.forked
  await deps
    .publishEvent(`conv.branch.forked:${projectId}`, {
      conversationId,
      roomId: head.roomId,
      projectId,
      branch: {
        id: newBranch.id,
        conversationId,
        projectId,
        name: newBranch.name,
        headNodeId: newBranch.headNodeId,
        forkedFromNode: head.nodeId,
        createdByKind: raisedBy.kind,
        createdById: raisedBy.id,
        status: 'active',
        createdAt: newBranch.createdAt,
        updatedAt: newBranch.createdAt,
      },
    })
    .catch((err: unknown) => {
      console.error('[interrupts] failed to emit conv.branch.forked', { err })
    })
}

// ── Summon handler ─────────────────────────────────────────────────────────────

async function handleSummon(event: InterruptEvent, deps: InterruptDeps): Promise<void> {
  const { conversationId, projectId, personaId, raisedBy } = event

  if (!personaId) {
    console.error('[interrupts] summon: personaId is required', { conversationId })
    return
  }

  const head = await deps.getConversationHeadNode(conversationId, projectId)
  if (!head) {
    console.error('[interrupts] summon: conversation head node not found', {
      conversationId,
    })
    return
  }

  // Enqueue agent-turn job, bypassing turn-policy scoring.
  const jobData = {
    projectId,
    conversationId,
    branchId: head.branchId ?? conversationId, // worker resolves actual branch if fallback
    triggerNodeId: head.nodeId,
    personaId,
    turnDepth: 0,
    triggerReason: 'mention' as const,
    otherSpeakers: [],
    forceSummon: true,
  }

  await deps.agentTurnsQueue.add('agent-turn', jobData, {
    group: {
      id: `conv:${conversationId}`,
      concurrency: 3,
    },
  })

  // Emit agent.summoned
  await deps
    .publishEvent(`agent.summoned:${projectId}`, {
      projectId,
      conversationId,
      personaId,
      summonedBy: raisedBy,
      ts: new Date().toISOString(),
    })
    .catch((err: unknown) => {
      console.error('[interrupts] failed to emit agent.summoned', { err })
    })
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Handle one interrupt event from the WebSocket gateway or internal source.
 *
 * Never throws — unexpected errors are logged and the function returns normally
 * so the event subscriber stays alive.
 */
export async function handleInterrupt(
  event: InterruptEvent,
  deps: InterruptDeps,
): Promise<void> {
  try {
    // ── Authorization ────────────────────────────────────────────────────────
    let authorized: boolean

    if (event.reason === 'stop' || event.reason === 'redirect') {
      authorized = await isStopAuthorized(event, deps)
    } else {
      authorized = await isSummonAuthorized(event, deps)
    }

    if (!authorized) {
      await rejectInterrupt(event, deps, 'unauthorized')
      return
    }

    // ── Dispatch ─────────────────────────────────────────────────────────────
    switch (event.reason) {
      case 'stop':
        await handleStop(event, deps)
        break
      case 'redirect':
        await handleRedirect(event, deps)
        break
      case 'summon':
        await handleSummon(event, deps)
        break
    }

    // ── Audit log ────────────────────────────────────────────────────────────
    await deps
      .auditLog({
        action: `interrupt.${event.reason}`,
        projectId: event.projectId,
        actorKind: event.raisedBy.kind,
        actorId: event.raisedBy.id,
        meta: {
          conversationId: event.conversationId,
          personaId: event.personaId ?? null,
          branchId: event.branchId ?? null,
        },
      })
      .catch((err: unknown) => {
        console.error('[interrupts] audit log failed', { err })
      })
  } catch (err) {
    console.error('[interrupts] unhandled error in handleInterrupt', { event, err })
  }
}
