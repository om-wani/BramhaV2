/**
 * Proactive PA scheduler — async orchestrator for stale-loop follow-ups.
 *
 * Runs on a BullMQ "proactive-check" queue (low-priority), enqueued
 * periodically or after each `conv.node.appended` event.
 *
 * Per-project logic:
 *   1. Early-exit if proactiveFollowups is disabled in project settings.
 *   2. Load all active (non-archived) conversations for the project.
 *   3. For each call/meeting room conversation, check all persona working
 *      memories for stale open loops (> 10 min unanswered).
 *   4. If a stale loop exists and the agent has not fired a proactive turn
 *      within the last hour (Redis rate-limit), enqueue an `agent-turn` job
 *      with triggerReason: 'follow-up'.
 *   5. Mark the rate-limit key in Redis (1h TTL).
 *
 * Security:
 *   - Rate limit: 1 proactive turn per agent per room per hour.
 *   - Never fires in archived rooms (roomArchivedAt !== null guard).
 *   - Off by default (settings.proactiveFollowups defaults to false).
 */

import type { Redis } from 'ioredis'
import {
  findStaleOpenLoops,
  isProactiveTurnAllowed,
  markProactiveTurnFired,
} from './proactive-check.js'
import type { WorkingMemory } from './working-memory.js'
import type { AgentTurnJobData } from '../orchestrator/turn-engine.js'

// ── Types ──────────────────────────────────────────────────────────────────────

export interface ActiveConversation {
  conversationId: string
  roomId: string
  /** 'call' | 'meeting' | 'conference' | 'office' | 'system' */
  roomType: string
  /** ISO timestamp or null if not archived */
  roomArchivedAt: string | null
  personaMemories: Array<{
    personaId: string
    memory: WorkingMemory
  }>
}

export interface ProactiveSchedulerDeps {
  redis: Redis
  /** Load all active (non-archived) conversations for a project with their working memories */
  loadActiveConversations: (projectId: string) => Promise<ActiveConversation[]>
  /** Check if proactive follow-ups are enabled for this project */
  isProactivityEnabled: (projectId: string) => Promise<boolean>
  /** Enqueue a proactive agent turn */
  enqueueTurn: (job: AgentTurnJobData) => Promise<void>
  /** Get the default branch ID for a conversation */
  getDefaultBranchId: (conversationId: string) => Promise<string | null>
  /** Get the last node ID on a branch (used as triggerNodeId) */
  getLastNodeId: (conversationId: string, branchId: string) => Promise<string | null>
}

// ── Scheduler ─────────────────────────────────────────────────────────────────

export class ProactiveScheduler {
  constructor(private readonly deps: ProactiveSchedulerDeps) {}

  /**
   * Check a single project for stale loops and enqueue proactive turns.
   *
   * @param projectId  Target project.
   * @param nowMs      Current time (injectable for testing; defaults to Date.now()).
   * @returns Number of proactive turns enqueued.
   */
  async checkProject(projectId: string, nowMs = Date.now()): Promise<number> {
    // ── 1. Feature gate ──────────────────────────────────────────────────────
    const enabled = await this.deps.isProactivityEnabled(projectId)
    if (!enabled) return 0

    const convos = await this.deps.loadActiveConversations(projectId)
    let enqueued = 0

    for (const convo of convos) {
      // ── 2. Skip archived rooms ─────────────────────────────────────────────
      if (convo.roomArchivedAt !== null) continue

      // ── 3. Only fire in call/meeting rooms (spec §2.4) ─────────────────────
      if (convo.roomType !== 'call' && convo.roomType !== 'meeting') continue

      for (const { personaId, memory } of convo.personaMemories) {
        // ── 4. Find stale open loops ─────────────────────────────────────────
        const stale = findStaleOpenLoops(
          personaId,
          convo.conversationId,
          convo.roomId,
          memory.openLoops,
          nowMs,
        )
        if (stale.length === 0) continue

        // ── 5. Rate-limit check ──────────────────────────────────────────────
        const allowed = await isProactiveTurnAllowed(personaId, convo.roomId, this.deps.redis)
        if (!allowed) continue

        // ── 6. Resolve branch + trigger node ────────────────────────────────
        const branchId = await this.deps.getDefaultBranchId(convo.conversationId)
        if (!branchId) continue

        const triggerNodeId = await this.deps.getLastNodeId(convo.conversationId, branchId)
        if (!triggerNodeId) continue

        // ── 7. Enqueue proactive agent turn ──────────────────────────────────
        await this.deps.enqueueTurn({
          projectId,
          conversationId: convo.conversationId,
          branchId,
          triggerNodeId,
          personaId,
          turnDepth: 0,
          triggerReason: 'follow-up',
          otherSpeakers: [],
        })

        // ── 8. Mark rate-limit ───────────────────────────────────────────────
        await markProactiveTurnFired(personaId, convo.roomId, this.deps.redis)
        enqueued++
      }
    }

    return enqueued
  }
}
