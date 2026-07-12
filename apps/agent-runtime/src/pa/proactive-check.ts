/**
 * Proactive PA check — pure functions (no I/O).
 *
 * Determines which open loops are stale and whether a proactive agent turn
 * is allowed (Redis rate-limit, 1/h per agent per room).
 *
 * Security:
 *   - Rate-limit key is namespaced; TTL enforced by Redis `EX`.
 *   - No user-supplied strings are interpolated into Redis keys without
 *     going through the namespaced helper.
 */

import type { OpenLoop } from './working-memory.js'

// ── Types ──────────────────────────────────────────────────────────────────────

export interface StaleLoopCheck {
  personaId: string
  conversationId: string
  roomId: string
  loop: OpenLoop
  staleSinceMs: number
}

// ── Pure helpers ───────────────────────────────────────────────────────────────

/** Default staleness threshold: 10 minutes. */
const DEFAULT_STALENESS_MS = 10 * 60 * 1_000

/**
 * Given a working-memory snapshot, return open loops that are stale
 * (unanswered for ≥ stalenessThresholdMs, default 10 min).
 */
export function findStaleOpenLoops(
  personaId: string,
  conversationId: string,
  roomId: string,
  openLoops: OpenLoop[],
  nowMs: number,
  stalenessThresholdMs = DEFAULT_STALENESS_MS,
): StaleLoopCheck[] {
  const active = openLoops.filter((l) => l.closedAt === undefined)
  return active
    .map((l) => ({
      personaId,
      conversationId,
      roomId,
      loop: l,
      staleSinceMs: nowMs - new Date(l.createdAt).getTime(),
    }))
    .filter((c) => c.staleSinceMs >= stalenessThresholdMs)
}

// ── Rate-limit helpers ─────────────────────────────────────────────────────────

/**
 * Rate-limit key: one proactive turn per agent per room per hour.
 */
export function proactiveRateLimitKey(personaId: string, roomId: string): string {
  return `proactive:rate:${personaId}:${roomId}`
}

/**
 * Atomically claim the proactive-turn slot for this agent+room.
 * Returns true if the slot was free and is now claimed (fires the turn).
 * Returns false if already claimed (another instance beat us, or already fired).
 * Uses SET NX EX to avoid TOCTOU race between concurrent scheduler instances.
 */
export async function claimProactiveTurn(
  redis: {
    set: (k: string, v: number, ex: 'EX', ttl: number, nx: 'NX') => Promise<string | null>
  },
  personaId: string,
  roomId: string,
): Promise<boolean> {
  const key = proactiveRateLimitKey(personaId, roomId)
  // SET key 1 EX 3600 NX — returns 'OK' if claimed, null if already set
  const result = await redis.set(key, 1, 'EX', 3600, 'NX')
  return result !== null
}
