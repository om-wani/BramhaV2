/**
 * NoteDeltaProcessor — BullMQ processor for `note.delta` jobs.
 *
 * Job payload: { noteId, projectId, contentMd }
 *
 * Steps:
 *  1. Parse + validate payload via Zod
 *  2. Extract markdown sections (reuses TextExtractor)
 *  3. Chunk sections (reuses chunkSections)
 *  4. Embed chunks (reuses embedChunks)
 *  5. Upsert to knowledge_chunks (origin='ceo_office', origin_id=noteId)
 *  6. Emit note.delta.done:{projectId}
 *
 * On failure: emit note.delta.failed:{projectId}, rethrow to let BullMQ handle retries.
 */
import { z } from 'zod'
import type { Job } from 'bullmq'
import type postgres from 'postgres'
import type { EmbeddingProvider } from '@bramha/agents'
import { NoteDeltaDonePayloadSchema, NoteDeltaFailedPayloadSchema } from '@bramha/shared'
import type { IPublisher } from './security/security-gate.processor.js'
import { TextExtractor } from './extractors/text.js'
import { chunkSections } from './chunking.js'
import { embedChunks } from './embedder.js'
import { upsertKnowledgeChunks } from './knowledge-writer.js'

const NoteDeltaJobDataSchema = z.object({
  noteId: z.string().uuid(),
  projectId: z.string().uuid(),
  contentMd: z.string(),
})

export type NoteDeltaJobData = z.infer<typeof NoteDeltaJobDataSchema>

function noteDeltaDoneChannel(projectId: string): string {
  return `note.delta.done:${projectId}`
}

function noteDeltaFailedChannel(projectId: string): string {
  return `note.delta.failed:${projectId}`
}

async function publishDone(
  publisher: IPublisher,
  projectId: string,
  payload: { noteId: string; projectId: string; chunkCount: number },
): Promise<void> {
  NoteDeltaDonePayloadSchema.parse(payload)
  await publisher.publish(noteDeltaDoneChannel(projectId), payload)
}

export interface NoteDeltaDeps {
  sql: postgres.Sql
  publisher: IPublisher
  embeddingProvider: EmbeddingProvider
}

export class NoteDeltaProcessor {
  private readonly extractor = new TextExtractor()

  constructor(private readonly deps: NoteDeltaDeps) {}

  async process(job: Job<unknown>): Promise<void> {
    // Step 1: Validate payload — throws ZodError on bad data (job fails, no ack)
    const data = NoteDeltaJobDataSchema.parse(job.data)
    const { noteId, projectId, contentMd } = data

    const log = (event: string, extra?: Record<string, unknown>) =>
      console.log(JSON.stringify({ event, noteId, projectId, ...extra }))

    try {
      // Step 2: Empty content — ack job cleanly, no chunks
      if (!contentMd.trim()) {
        log('note_delta.empty_content')
        await publishDone(this.deps.publisher, projectId, { noteId, projectId, chunkCount: 0 })
        return
      }

      log('note_delta.started')

      // Step 2: Extract markdown sections
      const buffer = Buffer.from(contentMd, 'utf8')
      const { sections } = await this.extractor.extract(buffer)

      // Step 3: Chunk sections
      const chunks = chunkSections(sections)

      if (chunks.length === 0) {
        log('note_delta.no_chunks')
        await publishDone(this.deps.publisher, projectId, { noteId, projectId, chunkCount: 0 })
        return
      }

      // Step 4: Embed chunks — never log content
      log('note_delta.embedding', { chunkCount: chunks.length })
      const embeddedChunks = await embedChunks(chunks, this.deps.embeddingProvider)

      // Step 5: Upsert to knowledge_chunks
      log('note_delta.writing')
      await upsertKnowledgeChunks({
        projectId,
        origin: 'ceo_office',
        originId: noteId,
        chunks: embeddedChunks,
        sql: this.deps.sql,
      })

      // Step 6: Emit done event
      await publishDone(this.deps.publisher, projectId, { noteId, projectId, chunkCount: embeddedChunks.length })

      log('note_delta.done', { chunkCount: embeddedChunks.length })
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      console.error(JSON.stringify({ event: 'note_delta.failed', noteId, projectId, err: reason }))

      try {
        const failedPayload = { noteId, projectId, reason }
        NoteDeltaFailedPayloadSchema.parse(failedPayload)
        await this.deps.publisher.publish(noteDeltaFailedChannel(projectId), failedPayload)
      } catch (pubErr) {
        console.error(JSON.stringify({ event: 'note_delta.publish_failed', err: String(pubErr) }))
      }

      throw err
    }
  }
}
