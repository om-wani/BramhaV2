/**
 * Extraction pipeline integration tests (mocked S3, DB, embedder).
 */
import { describe, it, expect, vi } from 'vitest'
import type { Job } from 'bullmq'
import { ExtractionPipelineProcessor } from './extraction-pipeline.processor.js'
import type { EmbeddingProvider } from '@bramha/agents'

// ── Constants ─────────────────────────────────────────────────────────────────

const FILE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const PROJECT_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

// ── Mock embedding provider ───────────────────────────────────────────────────

function makeEmbeddingProvider(
  impl?: (texts: string[]) => Promise<number[][]>,
): EmbeddingProvider {
  return {
    dimension: 1536,
    model: 'test-model',
    embed: impl ?? (async (texts) => texts.map(() => new Array(1536).fill(0.1) as number[])),
  }
}

// ── Mock SQL client ───────────────────────────────────────────────────────────

function makeSql() {
  let insertIdCounter = 0
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sql: any = vi.fn(async (): Promise<any[]> => {
    insertIdCounter++
    return [{ id: `job-id-${insertIdCounter}` }]
  })
  // Mock sql.begin() — runs the callback with the same sql mock as the transaction object
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sql.begin = async (cb: (tx: any) => Promise<void>) => {
    await cb(sql)
  }
  return sql
}

// ── Mock publisher ────────────────────────────────────────────────────────────

interface PublishCall {
  channel: string
  payload: unknown
}

function makePublisher() {
  const calls: PublishCall[] = []
  const publish = async (channel: string, payload: unknown): Promise<void> => {
    calls.push({ channel, payload })
  }
  return { publish, calls }
}

// ── Mock job ──────────────────────────────────────────────────────────────────

function makeJob(overrides: Record<string, unknown> = {}): Job<unknown> {
  return {
    data: {
      fileId: FILE_ID,
      projectId: PROJECT_ID,
      storageKey: `${PROJECT_ID}/${FILE_ID}/test.txt`,
      fileName: 'test.txt',
      declaredMime: 'text/plain',
      ...overrides,
    },
  } as unknown as Job<unknown>
}

function makePlainTextBuffer(content: string): Buffer {
  return Buffer.from(content, 'utf8')
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('ExtractionPipelineProcessor', () => {
  it('happy path: plain text → chunks → embeddings → DB upsert', async () => {
    const text = Array.from({ length: 50 }, (_, i) => `Sentence ${i} with content.`).join(' ')
    const buffer = makePlainTextBuffer(text)

    const downloadCleanFile = vi.fn(async () => buffer)
    const publisher = makePublisher()
    const sql = makeSql()

    const processor = new ExtractionPipelineProcessor({
      downloadCleanFile,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sql: sql as any,
      publisher,
      embeddingProvider: makeEmbeddingProvider(),
    })

    await processor.process(makeJob())

    expect(downloadCleanFile).toHaveBeenCalledOnce()
    expect(sql).toHaveBeenCalled()

    const doneCalls = publisher.calls.filter((c) => c.channel.startsWith('ingest.extraction.done:'))
    expect(doneCalls).toHaveLength(1)
    const donePayload = doneCalls[0]!.payload as { fileId: string; chunkCount: number }
    expect(donePayload.fileId).toBe(FILE_ID)
    expect(donePayload.chunkCount).toBeGreaterThan(0)
  })

  it('re-ingest: stale-swap SQL is called for both ingests', async () => {
    const text = 'Some content for ingestion testing purposes here.'
    const buffer = makePlainTextBuffer(text)

    const sqlCalls: string[] = []
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sql: any = vi.fn(async (...args: any[]): Promise<any[]> => {
      // Template literal first element is the query string array
      const queryStr: unknown = Array.isArray(args[0]) ? args[0][0] : ''
      sqlCalls.push(String(queryStr))
      return [{ id: 'job-123' }]
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    sql.begin = async (cb: (tx: any) => Promise<void>) => {
      await cb(sql)
    }

    const publisher = makePublisher()
    const processor = new ExtractionPipelineProcessor({
      downloadCleanFile: async () => buffer,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sql: sql as any,
      publisher,
      embeddingProvider: makeEmbeddingProvider(),
    })

    await processor.process(makeJob())
    await processor.process(makeJob())

    const staleUpdates = sqlCalls.filter((q) => q.includes('stale'))
    expect(staleUpdates.length).toBeGreaterThan(0)
  })

  it('embedding failure → job marked failed, error event emitted', async () => {
    const text = 'Test content for embedding failure scenario.'
    const buffer = makePlainTextBuffer(text)

    const publisher = makePublisher()
    const sql = makeSql()

    const failingProvider = makeEmbeddingProvider(async () => {
      throw new Error('API rate limit exceeded')
    })

    const processor = new ExtractionPipelineProcessor({
      downloadCleanFile: async () => buffer,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sql: sql as any,
      publisher,
      embeddingProvider: failingProvider,
    })

    await expect(processor.process(makeJob())).rejects.toThrow()

    const failedCalls = publisher.calls.filter((c) =>
      c.channel.startsWith('ingest.extraction.failed:'),
    )
    expect(failedCalls).toHaveLength(1)
    const payload = failedCalls[0]!.payload as { reason: string }
    expect(payload.reason).toContain('API rate limit')
  })

  it('empty extraction result → throws no_content and emits failed event', async () => {
    const buffer = Buffer.from('', 'utf8')

    const publisher = makePublisher()
    const sql = makeSql()

    const processor = new ExtractionPipelineProcessor({
      downloadCleanFile: async () => buffer,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sql: sql as any,
      publisher,
      embeddingProvider: makeEmbeddingProvider(),
    })

    await expect(processor.process(makeJob())).rejects.toThrow('no_content')

    const failedCalls = publisher.calls.filter((c) =>
      c.channel.startsWith('ingest.extraction.failed:'),
    )
    expect(failedCalls).toHaveLength(1)
    const payload = failedCalls[0]!.payload as { reason: string }
    expect(payload.reason).toContain('no_content')
  })
})
