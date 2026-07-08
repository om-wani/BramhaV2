/**
 * KnowledgeService — Hybrid search (lexical + vector RRF fusion).
 *
 * Security:
 *   - All DB queries run inside db.run({ userId, projectId }) — RLS enforces tenant isolation.
 *   - project_id is always in WHERE (defense in depth).
 *   - Origins validated by Zod before reaching service.
 *   - Query content is NEVER logged; only counts, ids, and durations.
 *   - Rate limited: 20 searches / user / minute (Lua atomic token bucket).
 */

import {
  Injectable,
  Logger,
  HttpException,
  HttpStatus,
  Inject,
} from '@nestjs/common'
import { createEmbeddingProvider, type EmbeddingProvider } from '@bramha/agents'
import type Redis from 'ioredis'
import type postgres from 'postgres'
import { RlsDbService } from '../common/db/rls-db.service'
import { REDIS_CLIENT } from '../common/redis/redis.module'
import type {
  KnowledgeChunkOrigin,
  KnowledgeSearchResult,
  KnowledgeSearchResultItem,
} from '@bramha/shared'

// ── Constants ─────────────────────────────────────────────────────────────────

const RATE_LIMIT_SEARCH_PER_MIN = 20
const QUERY_MAX_CHARS = 2048
const RRF_K = 60
const LEX_LIMIT = 40
const VEC_LIMIT = 40
const FUSION_TOP_N = 12
const ORIGIN_ID_DEDUPE_LIMIT = 3
const SNIPPET_CHARS = 300

/**
 * Atomic INCR + conditional EXPIRE in a single Lua round-trip.
 * Prevents permanent rate-limit keys if the process crashes between INCR and EXPIRE.
 */
const LUA_RATE_LIMIT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('EXPIRE', KEYS[1], 60)
end
return count
`

// ── Row types ─────────────────────────────────────────────────────────────────

interface ChunkRow {
  id: string
  origin: string
  origin_id: string
  chunk_index: number
  heading_trail: string[]
  content: string
  created_at: string
}

// ── Internal fusion type ──────────────────────────────────────────────────────

interface FusedChunk {
  row: ChunkRow
  score: number
}

// ── Service ───────────────────────────────────────────────────────────────────

type Tx = postgres.TransactionSql

@Injectable()
export class KnowledgeService {
  private readonly logger = new Logger(KnowledgeService.name)
  private readonly embedder: EmbeddingProvider | null

  constructor(
    private readonly db: RlsDbService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {
    try {
      this.embedder = createEmbeddingProvider()
    } catch (err) {
      this.logger.warn({
        event: 'knowledge.no_embedder',
        reason: (err as Error).message,
      })
      this.embedder = null
    }
  }

  // ── Rate limit ─────────────────────────────────────────────────────────────

  private async checkRateLimit(userId: string): Promise<void> {
    const key = `ratelimit:search:${userId}`
    const count = (await this.redis.eval(LUA_RATE_LIMIT, 1, key)) as number
    if (count > RATE_LIMIT_SEARCH_PER_MIN) {
      throw new HttpException(
        { statusCode: 429, code: 'rate_limit_exceeded', message: 'Too many searches' },
        HttpStatus.TOO_MANY_REQUESTS,
      )
    }
  }

  // ── Lexical search ─────────────────────────────────────────────────────────

  private async runLexicalSearch(
    tx: Tx,
    projectId: string,
    query: string,
    origins?: string[],
  ): Promise<ChunkRow[]> {
    if (origins && origins.length > 0) {
      return tx<ChunkRow[]>`
        SELECT id, origin, origin_id, chunk_index, heading_trail, content, created_at,
               ts_rank(content_tsv, plainto_tsquery('english', ${query})) AS lex_score
        FROM knowledge_chunks
        WHERE project_id = ${projectId}::uuid
          AND NOT stale
          AND origin = ANY(${origins})
          AND content_tsv @@ plainto_tsquery('english', ${query})
        ORDER BY lex_score DESC
        LIMIT ${LEX_LIMIT}
      `
    }
    return tx<ChunkRow[]>`
      SELECT id, origin, origin_id, chunk_index, heading_trail, content, created_at,
             ts_rank(content_tsv, plainto_tsquery('english', ${query})) AS lex_score
      FROM knowledge_chunks
      WHERE project_id = ${projectId}::uuid
        AND NOT stale
        AND content_tsv @@ plainto_tsquery('english', ${query})
      ORDER BY lex_score DESC
      LIMIT ${LEX_LIMIT}
    `
  }

  // ── Vector search ──────────────────────────────────────────────────────────

  private async runVectorSearch(
    tx: Tx,
    projectId: string,
    embedding: number[],
    origins?: string[],
  ): Promise<ChunkRow[]> {
    // Pass embedding as a string so Postgres casts it to vector.
    // The HNSW index requires NOT stale AND embedding IS NOT NULL in the WHERE clause.
    const vecStr = `[${embedding.join(',')}]`
    if (origins && origins.length > 0) {
      return tx<ChunkRow[]>`
        SELECT id, origin, origin_id, chunk_index, heading_trail, content, created_at,
               (embedding <=> ${vecStr}::vector) AS vec_distance
        FROM knowledge_chunks
        WHERE project_id = ${projectId}::uuid
          AND NOT stale
          AND embedding IS NOT NULL
          AND origin = ANY(${origins})
        ORDER BY vec_distance ASC
        LIMIT ${VEC_LIMIT}
      `
    }
    return tx<ChunkRow[]>`
      SELECT id, origin, origin_id, chunk_index, heading_trail, content, created_at,
             (embedding <=> ${vecStr}::vector) AS vec_distance
      FROM knowledge_chunks
      WHERE project_id = ${projectId}::uuid
        AND NOT stale
        AND embedding IS NOT NULL
      ORDER BY vec_distance ASC
      LIMIT ${VEC_LIMIT}
    `
  }

  // ── RRF fusion ─────────────────────────────────────────────────────────────

  /**
   * Reciprocal Rank Fusion (k=60).
   * score = Σ 1/(k + rank_i) across all result lists where chunk appears.
   * Ranks are 1-indexed.
   */
  rrfFuse(lexRows: ChunkRow[], vecRows: ChunkRow[]): FusedChunk[] {
    const scores = new Map<string, number>()
    const rowMap = new Map<string, ChunkRow>()

    lexRows.forEach((row, idx) => {
      const rank = idx + 1
      scores.set(row.id, (scores.get(row.id) ?? 0) + 1 / (RRF_K + rank))
      rowMap.set(row.id, row)
    })

    vecRows.forEach((row, idx) => {
      const rank = idx + 1
      scores.set(row.id, (scores.get(row.id) ?? 0) + 1 / (RRF_K + rank))
      if (!rowMap.has(row.id)) rowMap.set(row.id, row)
    })

    return [...scores.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([id, score]) => ({ row: rowMap.get(id)!, score }))
  }

  // ── Dedupe by origin_id ────────────────────────────────────────────────────

  dedupeByOriginId(chunks: FusedChunk[], maxPerOriginId: number): FusedChunk[] {
    const counts = new Map<string, number>()
    const result: FusedChunk[] = []
    for (const chunk of chunks) {
      const key = chunk.row.origin_id
      const seen = counts.get(key) ?? 0
      if (seen < maxPerOriginId) {
        result.push(chunk)
        counts.set(key, seen + 1)
      }
    }
    return result
  }

  // ── Recency boost ──────────────────────────────────────────────────────────

  applyRecencyBoost(chunks: FusedChunk[]): FusedChunk[] {
    const now = Date.now()
    return chunks.map((chunk) => {
      if (chunk.row.origin !== 'ceo_office') return chunk
      const ageDays =
        (now - new Date(chunk.row.created_at).getTime()) / (1000 * 60 * 60 * 24)
      const boost = 1 + 0.1 * Math.exp(-ageDays / 30)
      return { ...chunk, score: chunk.score * boost }
    })
  }

  // ── Main search ────────────────────────────────────────────────────────────

  async search(params: {
    projectId: string
    userId: string
    query: string
    origins?: string[]
    limit?: number
  }): Promise<KnowledgeSearchResult> {
    // 1. Truncate to max chars (estimate: 4 chars / token → 512 tokens max)
    const query = params.query.slice(0, QUERY_MAX_CHARS)
    if (!query.trim()) {
      return { items: [], query: '', lexicalCount: 0, vectorCount: 0, durationMs: 0 }
    }

    // 2. Rate limit check (atomic Lua token bucket)
    await this.checkRateLimit(params.userId)

    const t0 = Date.now()
    const limit = Math.min(params.limit ?? 10, 20)

    // 3. Embed query (graceful fallback: lexical-only when no embedder)
    let queryEmbedding: number[] | null = null
    if (this.embedder) {
      try {
        const embeddings = await this.embedder.embed([query])
        queryEmbedding = embeddings[0] ?? null
      } catch (embedErr) {
        this.logger.warn({
          event: 'knowledge.embed_failed',
          reason: (embedErr as Error).message,
        })
      }
    }

    // 4+5. Lexical and vector queries inside a single RLS-enforced transaction
    const { lexRows, vecRows } = await this.db.run(
      { userId: params.userId, projectId: params.projectId },
      async (tx) => {
        const lexRows = await this.runLexicalSearch(
          tx,
          params.projectId,
          query,
          params.origins,
        )
        const vecRows = queryEmbedding
          ? await this.runVectorSearch(tx, params.projectId, queryEmbedding, params.origins)
          : ([] as ChunkRow[])
        return { lexRows, vecRows }
      },
    )

    // 6. RRF fusion across both result lists
    const fused = this.rrfFuse(lexRows, vecRows)

    // 7. Take top-12 by RRF score
    const top12 = fused.slice(0, FUSION_TOP_N)

    // 8. Dedupe: max 3 chunks per origin_id
    const deduped = this.dedupeByOriginId(top12, ORIGIN_ID_DEDUPE_LIMIT)

    // 9. Recency boost: ceo_office chunks score multiplied by e^(-age/30) factor
    const boosted = this.applyRecencyBoost(deduped)

    // 10. Re-sort by final score, return top `limit`
    boosted.sort((a, b) => b.score - a.score)
    const topItems = boosted.slice(0, limit)

    const durationMs = Date.now() - t0

    // Never log query content
    this.logger.log({
      event: 'knowledge.search',
      userId: params.userId,
      projectId: params.projectId,
      resultCount: topItems.length,
      durationMs,
    })

    return {
      items: topItems.map(
        (c): KnowledgeSearchResultItem => ({
          chunkId: c.row.id,
          origin: c.row.origin as KnowledgeChunkOrigin,
          originId: c.row.origin_id,
          chunkIndex: c.row.chunk_index,
          headingTrail: c.row.heading_trail,
          snippet: c.row.content.slice(0, SNIPPET_CHARS),
          score: c.score,
        }),
      ),
      query,
      lexicalCount: lexRows.length,
      vectorCount: vecRows.length,
      durationMs,
    }
  }
}
