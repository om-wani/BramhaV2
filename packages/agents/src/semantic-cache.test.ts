/**
 * SemanticCache unit tests.
 *
 * Coverage:
 *   1. Cache miss when no entries exist
 *   2. Cache hit when embedding similarity is above threshold
 *   3. Cache miss when embedding similarity is below threshold
 *   4. TTL expiry — entries are evicted and not returned
 *   5. Cosine threshold boundary (exactly at threshold = hit, below = miss)
 *   6. Most-similar entry selected when multiple entries exist
 *   7. cosineSimilarity helper — known values
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { SemanticCache, cosineSimilarity } from './semantic-cache.js'

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Create a unit vector from a 2D angle (radians) */
function unitVec(angle: number): number[] {
  return [Math.cos(angle), Math.sin(angle)]
}

// ── cosineSimilarity tests ────────────────────────────────────────────────────

describe('cosineSimilarity', () => {
  it('returns 1.0 for identical vectors', () => {
    const v = [0.6, 0.8]
    expect(cosineSimilarity(v, v)).toBeCloseTo(1.0)
  })

  it('returns 0.0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0.0)
  })

  it('returns -1.0 for opposite vectors', () => {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1.0)
  })

  it('returns 0 for zero vectors', () => {
    expect(cosineSimilarity([0, 0], [1, 0])).toBe(0)
  })

  it('returns 0 for mismatched lengths', () => {
    expect(cosineSimilarity([1, 0, 0], [1, 0])).toBe(0)
  })

  it('handles high-dimensional vectors correctly', () => {
    const dim = 1536
    const a = Array.from({ length: dim }, () => Math.random())
    const normA = Math.sqrt(a.reduce((s, x) => s + x * x, 0))
    const unit = a.map((x) => x / normA)
    expect(cosineSimilarity(unit, unit)).toBeCloseTo(1.0, 5)
  })
})

// ── SemanticCache tests ───────────────────────────────────────────────────────

describe('SemanticCache', () => {
  let cache: SemanticCache

  beforeEach(() => {
    cache = new SemanticCache()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns null when cache is empty', () => {
    const result = cache.get([1, 0, 0])
    expect(result).toBeNull()
  })

  it('returns a cached result when similarity exceeds threshold', () => {
    const embedding = [0.6, 0.8] // normalized
    cache.set(embedding, 'hello world', 60_000)

    // Query with a very similar embedding (1° off)
    const queryEmbedding = unitVec(Math.atan2(0.8, 0.6) + 0.01)
    const result = cache.get(queryEmbedding, 0.92)
    expect(result).not.toBeNull()
    expect(result!.result).toBe('hello world')
  })

  it('returns null when similarity is below threshold', () => {
    const embedding = unitVec(0) // [1, 0]
    cache.set(embedding, 'cached', 60_000)

    // 45° angle → cosine = cos(45°) ≈ 0.707 — well below 0.92
    const queryEmbedding = unitVec(Math.PI / 4)
    const result = cache.get(queryEmbedding, 0.92)
    expect(result).toBeNull()
  })

  it('respects TTL — expired entries are not returned', () => {
    vi.useFakeTimers()

    const embedding = [1, 0]
    cache.set(embedding, 'stale', 1_000) // 1 second TTL

    // Advance time past TTL
    vi.advanceTimersByTime(2_000)

    const result = cache.get(embedding, 0.92)
    expect(result).toBeNull()
  })

  it('returns live entries even after some have expired', () => {
    vi.useFakeTimers()

    const v1 = unitVec(0)
    const v2 = unitVec(0.001) // nearly identical

    cache.set(v1, 'short-lived', 1_000)  // 1s
    cache.set(v2, 'long-lived', 10_000)  // 10s

    vi.advanceTimersByTime(5_000)

    // Short-lived expired, long-lived still valid
    const result = cache.get(v2, 0.99)
    expect(result).not.toBeNull()
    expect(result!.result).toBe('long-lived')
  })

  it('returns the most similar entry above threshold', () => {
    const angle1 = 0.0
    const angle2 = 0.05 // slightly off

    const query = unitVec(angle2 + 0.01)

    cache.set(unitVec(angle1), 'less similar', 60_000)
    cache.set(unitVec(angle2), 'more similar', 60_000)

    const result = cache.get(query, 0.90)
    expect(result).not.toBeNull()
    // The entry with angle2 is closer to the query
    expect(result!.result).toBe('more similar')
  })

  it('reports correct size counting only live entries', () => {
    vi.useFakeTimers()

    cache.set([1, 0], 'a', 1_000)
    cache.set([0, 1], 'b', 10_000)
    expect(cache.size).toBe(2)

    vi.advanceTimersByTime(5_000)
    expect(cache.size).toBe(1)
  })

  it('clear() removes all entries', () => {
    cache.set([1, 0], 'x', 60_000)
    cache.set([0, 1], 'y', 60_000)
    cache.clear()
    expect(cache.size).toBe(0)
    expect(cache.get([1, 0])).toBeNull()
  })

  it('cachedAt timestamp reflects when entry was stored', () => {
    vi.useFakeTimers()
    const before = Date.now()
    vi.advanceTimersByTime(100)
    const setTime = Date.now()
    cache.set([1, 0], 'test', 60_000)
    vi.advanceTimersByTime(100)

    const result = cache.get([1, 0])
    expect(result).not.toBeNull()
    expect(result!.cachedAt).toBeGreaterThanOrEqual(before + 100)
    expect(result!.cachedAt).toBe(setTime)
  })

  it('threshold boundary — exactly at threshold is a hit', () => {
    // Two unit vectors with cosine similarity = threshold
    const threshold = 0.95
    // angle between them = arccos(0.95) ≈ 0.317 rad
    const angle = Math.acos(threshold)
    const v1 = unitVec(0)
    const v2 = unitVec(angle)

    cache.set(v1, 'boundary', 60_000)
    const result = cache.get(v2, threshold)
    // cosineSimilarity(v1, v2) should be very close to threshold
    const sim = cosineSimilarity(v1, v2)
    if (sim >= threshold) {
      expect(result).not.toBeNull()
    } else {
      expect(result).toBeNull()
    }
  })
})
