/**
 * NoteDeltaProcessor unit tests (mocked DB, embedder, publisher).
 */
import { describe, it, expect, vi } from 'vitest'
import type { Job } from 'bullmq'
import { NoteDeltaProcessor } from './note-delta.processor.js'
import type { EmbeddingProvider } from '@bramha/agents'

// ── Constants ─────────────────────────────────────────────────────────────────

const NOTE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const PROJECT_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

// ── Mock helpers ──────────────────────────────────────────────────────────────

function makeEmbeddingProvider(
  impl?: (texts: string[]) => Promise<number[][]>,
): EmbeddingProvider {
  return {
    dimension: 1536,
    model: 'test-model',
    embed: impl ?? (async (texts) => texts.map(() => new Array(1536).fill(0.1) as number[])),
  }
}

function makeSql() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sql: any = vi.fn(async (): Promise<any[]> => {
    return [{ id: 'job-id-1' }]
  })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sql.begin = async (cb: (tx: any) => Promise<void>) => {
    await cb(sql)
  }
  return sql
}

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

function makeJob(data: Record<string, unknown> = {}): Job<unknown> {
  return {
    data: {
      noteId: NOTE_ID,
      projectId: PROJECT_ID,
      contentMd: '# Hello\n\nThis is a test note with some content.',
      ...data,
    },
  } as unknown as Job<unknown>
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('NoteDeltaProcessor', () => {
  it('happy path: contentMd → chunks → embeddings → upserted → event emitted', async () => {
    const contentMd = Array.from({ length: 30 }, (_, i) => `Sentence ${i} with meaningful content to chunk.`).join(' ')

    const sql = makeSql()
    const publisher = makePublisher()

    const processor = new NoteDeltaProcessor({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sql: sql as any,
      publisher,
      embeddingProvider: makeEmbeddingProvider(),
    })

    await processor.process(makeJob({ contentMd }))

    // SQL was called (upsertKnowledgeChunks uses sql.begin → sql calls)
    expect(sql).toHaveBeenCalled()

    // Done event was emitted
    const doneCalls = publisher.calls.filter((c) => c.channel === `note.delta.done:${PROJECT_ID}`)
    expect(doneCalls).toHaveLength(1)
    const payload = doneCalls[0]!.payload as { noteId: string; projectId: string; chunkCount: number }
    expect(payload.noteId).toBe(NOTE_ID)
    expect(payload.projectId).toBe(PROJECT_ID)
    expect(payload.chunkCount).toBeGreaterThan(0)

    // No failed events
    const failedCalls = publisher.calls.filter((c) => c.channel.startsWith('note.delta.failed:'))
    expect(failedCalls).toHaveLength(0)
  })

  it('empty contentMd → job acked, no chunks, no event', async () => {
    const sql = makeSql()
    const publisher = makePublisher()

    const processor = new NoteDeltaProcessor({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sql: sql as any,
      publisher,
      embeddingProvider: makeEmbeddingProvider(),
    })

    await processor.process(makeJob({ contentMd: '   ' }))

    // No events emitted at all
    expect(publisher.calls).toHaveLength(0)
    // SQL not called (no chunks to write)
    expect(sql).not.toHaveBeenCalled()
  })

  it('invalid payload → ZodError thrown → job fails', async () => {
    const sql = makeSql()
    const publisher = makePublisher()

    const processor = new NoteDeltaProcessor({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sql: sql as any,
      publisher,
      embeddingProvider: makeEmbeddingProvider(),
    })

    const badJob = {
      data: { noteId: 'not-a-uuid', projectId: 'bad' },
    } as unknown as Job<unknown>

    await expect(processor.process(badJob)).rejects.toThrow()

    // No events emitted (ZodError thrown before try/catch)
    expect(publisher.calls).toHaveLength(0)
  })

  it('embedding failure → throws + note.delta.failed emitted', async () => {
    const contentMd = 'Some content for embedding failure test.'

    const sql = makeSql()
    const publisher = makePublisher()

    const failingProvider = makeEmbeddingProvider(async () => {
      throw new Error('Embedding API error')
    })

    const processor = new NoteDeltaProcessor({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sql: sql as any,
      publisher,
      embeddingProvider: failingProvider,
    })

    await expect(processor.process(makeJob({ contentMd }))).rejects.toThrow()

    // Failed event was emitted
    const failedCalls = publisher.calls.filter((c) => c.channel === `note.delta.failed:${PROJECT_ID}`)
    expect(failedCalls).toHaveLength(1)
    const payload = failedCalls[0]!.payload as { noteId: string; reason: string }
    expect(payload.noteId).toBe(NOTE_ID)
    expect(payload.reason).toContain('Embedding API error')

    // No done events
    const doneCalls = publisher.calls.filter((c) => c.channel.startsWith('note.delta.done:'))
    expect(doneCalls).toHaveLength(0)
  })
})
