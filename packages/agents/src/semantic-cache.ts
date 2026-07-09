/**
 * Semantic cache for utility-tier LLM calls.
 *
 * Caches results (e.g. generated titles, tags) keyed by embedding similarity.
 * Similarity is measured by cosine distance against stored query embeddings.
 *
 * Design notes:
 *   - In-memory for Phase 3; swap to Redis-backed store in Phase 5.
 *   - TTL from ModelPolicy.cache.semanticCacheTTLs (seconds).
 *   - Thread-safe for single-process use (no locking needed in Node.js event loop).
 *   - Never logs query text or cached content; only counts and TTLs.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CachedResult {
  /** The cached LLM output */
  result: string
  /** Unix timestamp (ms) when this entry was stored */
  cachedAt: number
}

interface CacheEntry {
  embedding: number[]
  result: CachedResult
  expiresAt: number
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Cosine similarity in [-1, 1] between two equal-length vectors.
 * Returns 0 if either vector is zero-length.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0

  let dot = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < a.length; i++) {
    // eslint-disable-next-line security/detect-object-injection
    const ai = a[i] ?? 0
    // eslint-disable-next-line security/detect-object-injection
    const bi = b[i] ?? 0
    dot += ai * bi
    normA += ai * ai
    normB += bi * bi
  }

  const denom = Math.sqrt(normA) * Math.sqrt(normB)
  return denom === 0 ? 0 : dot / denom
}

// ── SemanticCache ─────────────────────────────────────────────────────────────

export class SemanticCache {
  private readonly entries: CacheEntry[] = []
  private getCount = 0

  /**
   * Look up a cached result by embedding similarity.
   *
   * Runs lazy TTL eviction every 100 reads to bound memory without blocking
   * the hot-path on every call.
   *
   * @param queryEmbedding - Embedding of the current query
   * @param threshold - Minimum cosine similarity to consider a cache hit (default: 0.92)
   * @returns The cached result if a matching entry is found and not expired, else null
   */
  get(queryEmbedding: number[], threshold = 0.92): CachedResult | null {
    const now = Date.now()

    // Lazy eviction: run every 100 reads to amortise the scan cost
    this.getCount++
    if (this.getCount % 100 === 0) {
      this.evictExpired(now)
    }

    let bestSimilarity = -Infinity
    let bestResult: CachedResult | null = null

    for (const entry of this.entries) {
      if (entry.expiresAt <= now) continue // expired

      const similarity = cosineSimilarity(queryEmbedding, entry.embedding)
      if (similarity >= threshold && similarity > bestSimilarity) {
        bestSimilarity = similarity
        bestResult = entry.result
      }
    }

    return bestResult
  }

  /**
   * Store a result in the cache.
   *
   * @param queryEmbedding - Embedding of the query that produced this result
   * @param result - The LLM output to cache
   * @param ttlMs - Time-to-live in milliseconds
   */
  set(queryEmbedding: number[], result: string, ttlMs: number): void {
    const now = Date.now()
    const entry: CacheEntry = {
      embedding: queryEmbedding,
      result: { result, cachedAt: now },
      expiresAt: now + ttlMs,
    }
    this.entries.push(entry)
    this.evictExpired(now)
  }

  /**
   * Remove all expired entries (called after each set to bound memory usage).
   */
  private evictExpired(now: number): void {
    let i = this.entries.length - 1
    while (i >= 0) {
      // eslint-disable-next-line security/detect-object-injection
      const entry = this.entries[i]
      if (entry !== undefined && entry.expiresAt <= now) {
        this.entries.splice(i, 1)
      }
      i--
    }
  }

  /** Returns the number of live (non-expired) entries — for diagnostics only. */
  get size(): number {
    const now = Date.now()
    return this.entries.filter((e) => e.expiresAt > now).length
  }

  /** Clear all entries (useful in tests). */
  clear(): void {
    this.entries.length = 0
  }
}
