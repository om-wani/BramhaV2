/**
 * Unit tests for proactive-check.ts — all pure / mock-only.
 */

import { describe, it, expect, vi } from 'vitest'
import {
  findStaleOpenLoops,
  proactiveRateLimitKey,
  isProactiveTurnAllowed,
  markProactiveTurnFired,
} from './proactive-check.js'
import type { OpenLoop } from './working-memory.js'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const PERSONA_ID = 'a1000001-0000-4000-8000-000000000001'
const CONV_ID    = 'a2000002-0000-4000-8000-000000000002'
const ROOM_ID    = 'a3000003-0000-4000-8000-000000000003'

const NOW_MS = new Date('2026-01-15T12:00:00Z').getTime()

const TEN_MIN_MS  = 10 * 60 * 1_000

function makeLoop(minutesAgo: number, closedAt?: string): OpenLoop {
  return {
    id: `loop-${minutesAgo}`,
    text: `question asked ${minutesAgo} minutes ago`,
    createdAt: new Date(NOW_MS - minutesAgo * 60 * 1_000).toISOString(),
    ...(closedAt !== undefined ? { closedAt } : {}),
  }
}

// ── findStaleOpenLoops ────────────────────────────────────────────────────────

describe('findStaleOpenLoops', () => {
  it('returns loops stale >= 10 min', () => {
    const loops: OpenLoop[] = [makeLoop(11), makeLoop(10)]
    const result = findStaleOpenLoops(PERSONA_ID, CONV_ID, ROOM_ID, loops, NOW_MS)
    expect(result).toHaveLength(2)
    expect(result.every((r) => r.staleSinceMs >= TEN_MIN_MS)).toBe(true)
  })

  it('does not return loops fresh (< 10 min)', () => {
    const loops: OpenLoop[] = [makeLoop(9), makeLoop(5)]
    const result = findStaleOpenLoops(PERSONA_ID, CONV_ID, ROOM_ID, loops, NOW_MS)
    expect(result).toHaveLength(0)
  })

  it('excludes already-closed loops', () => {
    const loops: OpenLoop[] = [
      makeLoop(11, new Date(NOW_MS - 5 * 60 * 1_000).toISOString()), // closed
      makeLoop(11), // open + stale
    ]
    const result = findStaleOpenLoops(PERSONA_ID, CONV_ID, ROOM_ID, loops, NOW_MS)
    expect(result).toHaveLength(1)
    expect(result[0]!.loop.id).toBe('loop-11')
  })

  it('clock-advanced: exactly 11 min old → fires; 9 min old → does not', () => {
    const loops: OpenLoop[] = [makeLoop(11), makeLoop(9)]
    const result = findStaleOpenLoops(PERSONA_ID, CONV_ID, ROOM_ID, loops, NOW_MS)
    const ids = result.map((r) => r.loop.id)
    expect(ids).toContain('loop-11')
    expect(ids).not.toContain('loop-9')
  })

  it('attaches correct metadata to each stale check', () => {
    const loops: OpenLoop[] = [makeLoop(15)]
    const result = findStaleOpenLoops(PERSONA_ID, CONV_ID, ROOM_ID, loops, NOW_MS)
    expect(result[0]).toMatchObject({
      personaId: PERSONA_ID,
      conversationId: CONV_ID,
      roomId: ROOM_ID,
    })
    expect(result[0]!.staleSinceMs).toBe(15 * 60 * 1_000)
  })

  it('respects custom stalenessThresholdMs', () => {
    const loops: OpenLoop[] = [makeLoop(3)]  // 3 min old
    // Custom threshold: 2 min → should be stale
    const result = findStaleOpenLoops(
      PERSONA_ID, CONV_ID, ROOM_ID, loops, NOW_MS, 2 * 60 * 1_000,
    )
    expect(result).toHaveLength(1)
  })

  it('handles empty open loops array', () => {
    const result = findStaleOpenLoops(PERSONA_ID, CONV_ID, ROOM_ID, [], NOW_MS)
    expect(result).toHaveLength(0)
  })
})

// ── proactiveRateLimitKey ─────────────────────────────────────────────────────

describe('proactiveRateLimitKey', () => {
  it('returns namespaced key with persona and room', () => {
    const key = proactiveRateLimitKey(PERSONA_ID, ROOM_ID)
    expect(key).toBe(`proactive:rate:${PERSONA_ID}:${ROOM_ID}`)
  })
})

// ── isProactiveTurnAllowed ────────────────────────────────────────────────────

describe('isProactiveTurnAllowed', () => {
  it('returns true when Redis returns null (key absent)', async () => {
    const redis = { get: vi.fn().mockResolvedValue(null) }
    const allowed = await isProactiveTurnAllowed(PERSONA_ID, ROOM_ID, redis)
    expect(allowed).toBe(true)
  })

  it('returns false when Redis returns a value (key present)', async () => {
    const redis = { get: vi.fn().mockResolvedValue('1') }
    const allowed = await isProactiveTurnAllowed(PERSONA_ID, ROOM_ID, redis)
    expect(allowed).toBe(false)
  })

  it('queries the correct rate-limit key', async () => {
    const redis = { get: vi.fn().mockResolvedValue(null) }
    await isProactiveTurnAllowed(PERSONA_ID, ROOM_ID, redis)
    expect(redis.get).toHaveBeenCalledWith(`proactive:rate:${PERSONA_ID}:${ROOM_ID}`)
  })
})

// ── markProactiveTurnFired ────────────────────────────────────────────────────

describe('markProactiveTurnFired', () => {
  it('calls redis.set with 1h TTL (EX 3600)', async () => {
    const redis = { set: vi.fn().mockResolvedValue('OK') }
    await markProactiveTurnFired(PERSONA_ID, ROOM_ID, redis)
    expect(redis.set).toHaveBeenCalledWith(
      `proactive:rate:${PERSONA_ID}:${ROOM_ID}`,
      1,
      'EX',
      3600,
    )
  })
})
