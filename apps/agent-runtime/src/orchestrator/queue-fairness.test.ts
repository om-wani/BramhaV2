/**
 * ConversationQueueFairness unit tests.
 *
 * All I/O is mocked — no Redis connection required.
 */

import { describe, it, expect, vi } from 'vitest'
import { ConversationQueueFairness } from './queue-fairness.js'
import type { QueueFairnessDeps } from './queue-fairness.js'
import type { RedisLike } from '@bramha/mcp-connectors'

// ── Mock factory ──────────────────────────────────────────────────────────────

function makeRedis(overrides?: Partial<RedisLike>): RedisLike {
  return {
    get: vi.fn(),
    set: vi.fn(),
    del: vi.fn(),
    incr: vi.fn(),
    expire: vi.fn(),
    zrank: vi.fn().mockResolvedValue(null),
    zadd: vi.fn().mockResolvedValue(1),
    zremrangebyscore: vi.fn().mockResolvedValue(0),
    ...overrides,
  } as unknown as RedisLike
}

function makeDeps(overrides?: Partial<RedisLike>): QueueFairnessDeps {
  return { redis: makeRedis(overrides) }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('ConversationQueueFairness.getPriority', () => {
  it('returns 50 and adds to sorted set when conversation is new (zrank → null)', async () => {
    const deps = makeDeps({ zrank: vi.fn().mockResolvedValue(null) })
    const fairness = new ConversationQueueFairness('conv-events', deps)

    const priority = await fairness.getPriority('conv-aaa')

    expect(priority).toBe(50)
    expect(deps.redis.zadd).toHaveBeenCalledOnce()
    const [key, , member] = (deps.redis.zadd as ReturnType<typeof vi.fn>).mock.calls[0] as [string, number, string]
    expect(key).toBe('queue:fair:conv-events')
    expect(member).toBe('conv-aaa')
  })

  it('maps rank 0 to priority 1 (longest-waiting gets highest priority)', async () => {
    const deps = makeDeps({ zrank: vi.fn().mockResolvedValue(0) })
    const fairness = new ConversationQueueFairness('conv-events', deps)

    const priority = await fairness.getPriority('conv-bbb')

    expect(priority).toBe(1)
    // zrank found the conversation — zadd should NOT be called
    expect(deps.redis.zadd).not.toHaveBeenCalled()
  })

  it('maps rank 4 to priority 5', async () => {
    const deps = makeDeps({ zrank: vi.fn().mockResolvedValue(4) })
    const fairness = new ConversationQueueFairness('conv-events', deps)

    const priority = await fairness.getPriority('conv-ccc')

    expect(priority).toBe(5)
  })

  it('caps priority at 100 for very high ranks', async () => {
    const deps = makeDeps({ zrank: vi.fn().mockResolvedValue(999) })
    const fairness = new ConversationQueueFairness('conv-events', deps)

    const priority = await fairness.getPriority('conv-ddd')

    expect(priority).toBe(100)
  })
})

describe('ConversationQueueFairness.onJobStarted', () => {
  it('calls zadd with current timestamp and the correct key', async () => {
    const before = Date.now()
    const deps = makeDeps()
    const fairness = new ConversationQueueFairness('conv-events', deps)

    await fairness.onJobStarted('conv-eee')

    const after = Date.now()
    expect(deps.redis.zadd).toHaveBeenCalledOnce()
    const [key, score, member] = (deps.redis.zadd as ReturnType<typeof vi.fn>).mock.calls[0] as [string, number, string]
    expect(key).toBe('queue:fair:conv-events')
    expect(score).toBeGreaterThanOrEqual(before)
    expect(score).toBeLessThanOrEqual(after)
    expect(member).toBe('conv-eee')
  })
})

describe('ConversationQueueFairness.pruneStale', () => {
  it('calls zremrangebyscore with -inf and (now - olderThanMs) as cutoff', async () => {
    const deps = makeDeps()
    const fairness = new ConversationQueueFairness('conv-events', deps)
    const cutoffMs = 2 * 60 * 60 * 1000 // 2 hours

    const before = Date.now()
    await fairness.pruneStale(cutoffMs)
    const after = Date.now()

    expect(deps.redis.zremrangebyscore).toHaveBeenCalledOnce()
    const [key, min, max] = (deps.redis.zremrangebyscore as ReturnType<typeof vi.fn>).mock.calls[0] as [string, string | number, number]
    expect(key).toBe('queue:fair:conv-events')
    expect(min).toBe('-inf')
    // cutoff = now - 2h; should be within the before/after window
    expect(max).toBeGreaterThanOrEqual(before - cutoffMs)
    expect(max).toBeLessThanOrEqual(after - cutoffMs)
  })

  it('uses default 1-hour cutoff when olderThanMs is omitted', async () => {
    const deps = makeDeps()
    const fairness = new ConversationQueueFairness('conv-events', deps)

    const before = Date.now()
    await fairness.pruneStale() // default = 1h
    const after = Date.now()

    const [, , max] = (deps.redis.zremrangebyscore as ReturnType<typeof vi.fn>).mock.calls[0] as [string, string | number, number]
    const oneHourMs = 60 * 60 * 1000
    expect(max).toBeGreaterThanOrEqual(before - oneHourMs)
    expect(max).toBeLessThanOrEqual(after - oneHourMs)
  })

  it('uses the correct sorted-set key for the queue name', async () => {
    const deps = makeDeps()
    const fairness = new ConversationQueueFairness('my-special-queue', deps)

    await fairness.pruneStale()

    const [key] = (deps.redis.zremrangebyscore as ReturnType<typeof vi.fn>).mock.calls[0] as [string, ...unknown[]]
    expect(key).toBe('queue:fair:my-special-queue')
  })
})
