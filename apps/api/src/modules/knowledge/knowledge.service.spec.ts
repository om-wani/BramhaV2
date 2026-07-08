import { vi, describe, it, expect, beforeEach } from 'vitest'

// ── Mocks (must come before any imports that pull in the mocked modules) ─────

vi.mock('@bramha/db', () => ({ withTenant: vi.fn() }))
vi.mock('@bramha/agents', () => ({
  createEmbeddingProvider: vi.fn(),
}))

// ── Actual imports ─────────────────────────────────────────────────────────────

import { HttpException } from '@nestjs/common'
import { KnowledgeService } from './knowledge.service'
import { createEmbeddingProvider } from '@bramha/agents'
import type { RlsDbService } from '../common/db/rls-db.service'
import type postgres from 'postgres'

// ── Constants ──────────────────────────────────────────────────────────────────

const USER_ID = '550e8400-e29b-41d4-a716-446655440000'
const PROJECT_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'
const ORIGIN_ID_A = '6ba7b810-9dad-11d1-80b4-00c04fd430c8'
const ORIGIN_ID_B = '7ba7b810-9dad-11d1-80b4-00c04fd430c8'

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeChunkRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: '00000000-0000-0000-0000-000000000001',
    origin: 'upload',
    origin_id: ORIGIN_ID_A,
    chunk_index: 0,
    heading_trail: ['Introduction'],
    content: 'This is the content of the chunk.',
    created_at: new Date().toISOString(),
    ...overrides,
  }
}

/**
 * Build a mock postgres.js TransactionSql that returns successive results.
 * Each call to tx`...` pops the next result from the array.
 */
function makeTx(...resultSets: unknown[][]): postgres.TransactionSql {
  let call = 0
  return vi.fn().mockImplementation(
    () => Promise.resolve(resultSets[call++] ?? []),
  ) as unknown as postgres.TransactionSql
}

const mockEmbedder = {
  embed: vi.fn().mockResolvedValue([[0.1, 0.2, 0.3]]),
  dimension: 3,
  model: 'mock-model',
}

function buildMocks() {
  const db: Partial<RlsDbService> = { run: vi.fn() }
  const redis = { eval: vi.fn().mockResolvedValue(1) }
  return { db, redis }
}

function buildService(
  mocks: ReturnType<typeof buildMocks>,
  embedderFactory: () => unknown = () => mockEmbedder,
): KnowledgeService {
  vi.mocked(createEmbeddingProvider).mockImplementation(embedderFactory as () => ReturnType<typeof createEmbeddingProvider>)
  return new KnowledgeService(
    mocks.db as RlsDbService,
    mocks.redis as unknown as import('ioredis').default,
  )
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('KnowledgeService', () => {
  let svc: KnowledgeService
  let mocks: ReturnType<typeof buildMocks>

  beforeEach(() => {
    vi.clearAllMocks()
    mocks = buildMocks()
    svc = buildService(mocks)
  })

  // ── 1. Happy path ─────────────────────────────────────────────────────────

  it('happy path: overlapping chunk ranks above non-overlapping chunks', async () => {
    // chunk-A appears in both lists (position 0 in lex, position 0 in vec)
    // chunk-B only in lex, chunk-C only in vec
    const chunkA = makeChunkRow({ id: 'aaaaaaaa-0000-0000-0000-000000000001', content: 'Aaa' })
    const chunkB = makeChunkRow({ id: 'bbbbbbbb-0000-0000-0000-000000000001', content: 'Bbb', origin_id: ORIGIN_ID_B })
    const chunkC = makeChunkRow({ id: 'cccccccc-0000-0000-0000-000000000001', content: 'Ccc', origin_id: ORIGIN_ID_B })

    // lexResults: [A, B]  vecResults: [A, C]
    vi.mocked(mocks.db.run!).mockImplementation(async (_ctx, fn) => {
      return fn(makeTx([chunkA, chunkB], [chunkA, chunkC]))
    })

    const result = await svc.search({ projectId: PROJECT_ID, userId: USER_ID, query: 'test' })

    // chunk-A (in both lists) should appear first
    expect(result.items[0]!.chunkId).toBe(chunkA.id)
    expect(result.items.length).toBeGreaterThanOrEqual(3)
  })

  // ── 2. RRF formula correctness ────────────────────────────────────────────

  it('RRF: chunk in both lists scores higher than chunk in only one list', () => {
    const chunkBoth = makeChunkRow({ id: 'aaa-0000', origin_id: 'oo1' })
    const chunkLexOnly = makeChunkRow({ id: 'bbb-0000', origin_id: 'oo2' })
    const chunkVecOnly = makeChunkRow({ id: 'ccc-0000', origin_id: 'oo3' })

    const fused = svc.rrfFuse(
      [chunkBoth, chunkLexOnly],  // lex: rank 1, rank 2
      [chunkBoth, chunkVecOnly],  // vec: rank 1, rank 2
    )

    const bothEntry = fused.find((f) => f.row.id === chunkBoth.id)!
    const lexOnlyEntry = fused.find((f) => f.row.id === chunkLexOnly.id)!
    const vecOnlyEntry = fused.find((f) => f.row.id === chunkVecOnly.id)!

    // chunkBoth: 1/61 + 1/61 ≈ 0.0328
    expect(bothEntry.score).toBeCloseTo(1 / 61 + 1 / 61, 6)
    // chunkLexOnly: 1/62 ≈ 0.0161
    expect(lexOnlyEntry.score).toBeCloseTo(1 / 62, 6)
    // chunkVecOnly: 1/62 ≈ 0.0161
    expect(vecOnlyEntry.score).toBeCloseTo(1 / 62, 6)
    // Both ranks higher than single-list chunks
    expect(bothEntry.score).toBeGreaterThan(lexOnlyEntry.score)
    expect(bothEntry.score).toBeGreaterThan(vecOnlyEntry.score)
  })

  // ── 3. Origin dedupe ──────────────────────────────────────────────────────

  it('dedupe: keeps at most 3 chunks per origin_id', () => {
    const SAME_ORIGIN = 'same-origin-0000-0000-0000-000000000001'
    const chunks = Array.from({ length: 5 }, (_, i) => ({
      row: makeChunkRow({ id: `chunk-${i}-000000000000000000000000`, origin_id: SAME_ORIGIN }),
      score: 1 - i * 0.01,
    }))

    const deduped = svc.dedupeByOriginId(chunks, 3)

    expect(deduped).toHaveLength(3)
    // All kept entries have the same origin_id
    deduped.forEach((c) => expect(c.row.origin_id).toBe(SAME_ORIGIN))
  })

  // ── 4. Recency boost ──────────────────────────────────────────────────────

  it('recency boost: age=0 ceo_office chunk scores higher than age=30 ceo_office chunk', () => {
    const fresh = {
      row: makeChunkRow({
        id: 'fresh-000',
        origin: 'ceo_office',
        origin_id: 'oid-fresh',
        created_at: new Date().toISOString(),
      }),
      score: 1 / 61,
    }
    const old = {
      row: makeChunkRow({
        id: 'old-00000',
        origin: 'ceo_office',
        origin_id: 'oid-old',
        created_at: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
      }),
      score: 1 / 61,
    }

    const boosted = svc.applyRecencyBoost([fresh, old])
    const freshBoosted = boosted.find((c) => c.row.id === fresh.row.id)!
    const oldBoosted = boosted.find((c) => c.row.id === old.row.id)!

    // Fresh: score * (1 + 0.1 * e^0) ≈ score * 1.1
    expect(freshBoosted.score).toBeCloseTo((1 / 61) * 1.1, 6)
    // Old (age=30 days): score * (1 + 0.1 * e^(-1)) ≈ score * 1.0368
    expect(oldBoosted.score).toBeCloseTo((1 / 61) * (1 + 0.1 * Math.exp(-1)), 6)
    // Fresh scores higher than old
    expect(freshBoosted.score).toBeGreaterThan(oldBoosted.score)
  })

  // ── 5. Empty query ────────────────────────────────────────────────────────

  it('returns empty result for whitespace-only query', async () => {
    const result = await svc.search({
      projectId: PROJECT_ID,
      userId: USER_ID,
      query: '   ',
    })

    expect(result.items).toHaveLength(0)
    expect(result.lexicalCount).toBe(0)
    expect(result.vectorCount).toBe(0)
    // db.run should never be called for empty query
    expect(mocks.db.run).not.toHaveBeenCalled()
  })

  // ── 6. No embedder: lexical-only fallback ─────────────────────────────────

  it('falls back to lexical-only when no embedding provider is configured', async () => {
    // Build a new service instance where createEmbeddingProvider throws
    const noEmbedMocks = buildMocks()
    const noEmbedSvc = buildService(noEmbedMocks, () => {
      throw new Error('no_embedding_provider')
    })

    const chunk = makeChunkRow({ id: 'lex-only-chunk-0000000000000000001' })

    // db.run callback: lex query returns 1 chunk, vec query NOT called
    vi.mocked(noEmbedMocks.db.run!).mockImplementation(async (_ctx, fn) => {
      // Only 1 tx call (lexical); second call would return []
      return fn(makeTx([chunk], []))
    })

    const result = await noEmbedSvc.search({
      projectId: PROJECT_ID,
      userId: USER_ID,
      query: 'find something',
    })

    // Returns results from lexical path
    expect(result.items).toHaveLength(1)
    expect(result.items[0]!.chunkId).toBe(chunk.id)
    // Vector count is 0 (no embedding done)
    expect(result.vectorCount).toBe(0)
    expect(result.lexicalCount).toBe(1)
  })

  // ── 7. Origins filter ─────────────────────────────────────────────────────

  it('passes origins filter into db.run context', async () => {
    const chunk = makeChunkRow({ id: 'upload-chunk-00000000000000000001', origin: 'upload' })

    vi.mocked(mocks.db.run!).mockImplementation(async (_ctx, fn) => {
      return fn(makeTx([chunk], [chunk]))
    })

    const result = await svc.search({
      projectId: PROJECT_ID,
      userId: USER_ID,
      query: 'quarterly report',
      origins: ['upload'],
    })

    // db.run was called with the correct tenant context
    expect(mocks.db.run).toHaveBeenCalledWith(
      { userId: USER_ID, projectId: PROJECT_ID },
      expect.any(Function),
    )
    // Result contains only upload-origin chunk
    expect(result.items.every((i) => i.origin === 'upload')).toBe(true)
  })

  // ── 8. Rate limit ─────────────────────────────────────────────────────────

  it('throws 429 when rate limit is exceeded (21st call)', async () => {
    // Simulate Redis returning count=21 (exceeds limit of 20)
    mocks.redis.eval = vi.fn().mockResolvedValue(21)
    const limitedSvc = buildService(mocks)

    await expect(
      limitedSvc.search({ projectId: PROJECT_ID, userId: USER_ID, query: 'hello' }),
    ).rejects.toThrow(HttpException)

    // Verify the exception is 429
    try {
      await limitedSvc.search({ projectId: PROJECT_ID, userId: USER_ID, query: 'hello' })
    } catch (err) {
      expect((err as HttpException).getStatus()).toBe(429)
    }
  })

  // ── 9. Cross-tenant isolation ─────────────────────────────────────────────

  it('passes correct { userId, projectId } context to db.run (RLS tenant isolation)', async () => {
    const OTHER_PROJECT = 'ffffffff-ffff-ffff-ffff-ffffffffffff'

    vi.mocked(mocks.db.run!).mockImplementation(async (_ctx, fn) => {
      return fn(makeTx([], []))
    })

    await svc.search({ projectId: OTHER_PROJECT, userId: USER_ID, query: 'data' })

    expect(mocks.db.run).toHaveBeenCalledWith(
      { userId: USER_ID, projectId: OTHER_PROJECT },
      expect.any(Function),
    )
    // Ensure it was NOT called with PROJECT_ID (different tenant)
    expect(mocks.db.run).not.toHaveBeenCalledWith(
      { userId: USER_ID, projectId: PROJECT_ID },
      expect.any(Function),
    )
  })
})
