/**
 * ExtractionPipelineProcessor — second BullMQ processor for `extract.file` jobs.
 *
 * Job payload: { fileId, projectId, storageKey, fileName, declaredMime }
 *
 * Pipeline steps:
 *   1. INSERT ingestion_job row, status='extracting'
 *   2. Download file from bramha-clean bucket
 *   3. Extract text using type-appropriate extractor
 *   4. UPDATE status='chunking'
 *   5. Chunk text (512-token target, 64-token overlap)
 *   6. UPDATE status='embedding'
 *   7. Embed chunks via EmbeddingProvider
 *   8. Upsert to knowledge_chunks
 *   9. UPDATE status='done', stats
 *  10. Emit ingest.extraction.done:{projectId}
 *
 * On failure: UPDATE status='failed', error=message, emit ingest.extraction.failed
 */
import { z } from 'zod'
import type { Job } from 'bullmq'
import type postgres from 'postgres'
import type { EmbeddingProvider } from '@bramha/agents'
import {
  ExtractionDonePayloadSchema,
  ExtractionFailedPayloadSchema,
} from '@bramha/shared'
import type { IPublisher } from './security/security-gate.processor.js'
import { createExtractor } from './extractors/index.js'
import { chunkSections } from './chunking.js'
import { embedChunks } from './embedder.js'
import { upsertKnowledgeChunks } from './knowledge-writer.js'

// ── Status type ───────────────────────────────────────────────────────────────

export type IngestionJobStatus =
  | 'queued'
  | 'security_gate'
  | 'extracting'
  | 'chunking'
  | 'embedding'
  | 'done'
  | 'failed'
  | 'quarantined'

// ── Job payload schema ────────────────────────────────────────────────────────

export const ExtractFileJobDataSchema = z.object({
  fileId: z.string().uuid(),
  projectId: z.string().uuid(),
  storageKey: z.string().min(1),
  fileName: z.string().min(1),
  declaredMime: z.string().min(1),
})

export type ExtractFileJobData = z.infer<typeof ExtractFileJobDataSchema>

// ── Channels ──────────────────────────────────────────────────────────────────

function extractionDoneChannel(projectId: string): string {
  return `ingest.extraction.done:${projectId}`
}

function extractionFailedChannel(projectId: string): string {
  return `ingest.extraction.failed:${projectId}`
}

// ── Deps ──────────────────────────────────────────────────────────────────────

export interface ExtractionPipelineDeps {
  /** Download file from the clean bucket. */
  downloadCleanFile: (storageKey: string) => Promise<Buffer>
  /** Direct postgres.js Sql client (BYPASSRLS). */
  sql: postgres.Sql
  /** Event publisher. */
  publisher: IPublisher
  /** Embedding provider. */
  embeddingProvider: EmbeddingProvider
}

// ── Processor ─────────────────────────────────────────────────────────────────

export class ExtractionPipelineProcessor {
  constructor(private readonly deps: ExtractionPipelineDeps) {}

  async process(job: Job<unknown>): Promise<void> {
    const data = ExtractFileJobDataSchema.parse(job.data)
    const { fileId, projectId, storageKey, fileName, declaredMime } = data

    const log = (event: string, extra?: Record<string, unknown>) =>
      console.log(JSON.stringify({ event, fileId, projectId, ...extra }))

    let jobId: string | undefined

    try {
      // ── Pre-flight: Verify fileId belongs to this projectId ─────────────────
      // Guards against tampered BullMQ job payloads that specify a fileId from
      // a different project.
      const fileRows = await this.deps.sql`
        SELECT id FROM files WHERE id = ${fileId}::uuid AND project_id = ${projectId}::uuid
      `
      if (fileRows.length === 0) {
        console.error(
          JSON.stringify({ event: 'extraction.file_not_found_in_project', fileId, projectId }),
        )
        // Cannot update ingestion_job since jobId is not yet created.
        // Re-throw as a non-retryable error by returning cleanly (BullMQ acks).
        const failedPayload = { fileId, projectId, reason: 'file_not_found_in_project' }
        ExtractionFailedPayloadSchema.parse(failedPayload)
        await this.deps.publisher.publish(extractionFailedChannel(projectId), failedPayload)
        return
      }

      // ── Step 1: INSERT ingestion_job ────────────────────────────────────────
      const inserted = await this.deps.sql<[{ id: string }]>`
        INSERT INTO ingestion_jobs
          (project_id, kind, file_id, status)
        VALUES (
          ${projectId}::uuid,
          'file',
          ${fileId}::uuid,
          'extracting'
        )
        RETURNING id
      `
      jobId = inserted[0]?.id
      log('extraction.started', { ingestionJobId: jobId })

      // ── Step 2: Download clean file ─────────────────────────────────────────
      log('extraction.downloading')
      const buffer = await this.deps.downloadCleanFile(storageKey)

      // ── Step 3: Extract text ────────────────────────────────────────────────
      log('extraction.extracting', { declaredMime, fileName })
      const extractor = createExtractor(declaredMime, fileName)
      const extractionResult = await extractor.extract(buffer, fileName, declaredMime)

      if (extractionResult.sections.length === 0) {
        throw new Error('no_content')
      }

      // ── Step 4: Update status=chunking ──────────────────────────────────────
      if (jobId) {
        await this.updateJobStatus(jobId, 'chunking')
      }
      log('extraction.chunking')

      // ── Step 5: Chunk ───────────────────────────────────────────────────────
      const chunks = chunkSections(extractionResult.sections)
      log('extraction.chunked', { chunkCount: chunks.length })

      if (chunks.length === 0) {
        throw new Error('no_content')
      }

      // ── Step 6: Update status=embedding ─────────────────────────────────────
      if (jobId) {
        await this.updateJobStatus(jobId, 'embedding')
      }
      log('extraction.embedding', { chunkCount: chunks.length })

      // ── Step 7: Embed ────────────────────────────────────────────────────────
      const embeddedChunks = await embedChunks(chunks, this.deps.embeddingProvider)

      // ── Step 8: Upsert to knowledge_chunks ──────────────────────────────────
      log('extraction.writing')
      await upsertKnowledgeChunks({
        projectId,
        origin: 'upload',
        originId: fileId,
        chunks: embeddedChunks,
        sql: this.deps.sql,
      })

      const tokenTotal = chunks.reduce((sum, c) => sum + c.tokenCount, 0)

      // ── Step 9: Update status=done ───────────────────────────────────────────
      if (jobId) {
        await this.deps.sql`
          UPDATE ingestion_jobs
          SET
            status = 'done',
            stats  = ${JSON.stringify({
              chunkCount: embeddedChunks.length,
              tokenTotal,
              embeddingDim: this.deps.embeddingProvider.dimension,
            })}::jsonb,
            updated_at = NOW()
          WHERE id = ${jobId}::uuid
        `
      }

      // ── Step 10: Emit done event ─────────────────────────────────────────────
      const donePayload = { fileId, projectId, chunkCount: embeddedChunks.length }
      ExtractionDonePayloadSchema.parse(donePayload)
      await this.deps.publisher.publish(extractionDoneChannel(projectId), donePayload)

      log('extraction.done', { chunkCount: embeddedChunks.length, tokenTotal })
    } catch (err) {
      const reason = String(err)
      console.error(
        JSON.stringify({ event: 'extraction.failed', fileId, projectId, err: reason }),
      )

      if (jobId) {
        try {
          await this.deps.sql`
            UPDATE ingestion_jobs
            SET
              status     = 'failed',
              error      = ${reason},
              updated_at = NOW()
            WHERE id = ${jobId}::uuid
          `
        } catch (dbErr) {
          console.error(
            JSON.stringify({ event: 'extraction.db_update_failed', err: String(dbErr) }),
          )
        }
      }

      try {
        const failedPayload = { fileId, projectId, reason }
        ExtractionFailedPayloadSchema.parse(failedPayload)
        await this.deps.publisher.publish(extractionFailedChannel(projectId), failedPayload)
      } catch (pubErr) {
        console.error(
          JSON.stringify({ event: 'extraction.publish_failed', err: String(pubErr) }),
        )
      }

      throw err
    }
  }

  private async updateJobStatus(jobId: string, status: IngestionJobStatus): Promise<void> {
    await this.deps.sql`
      UPDATE ingestion_jobs
      SET status = ${status}, updated_at = NOW()
      WHERE id = ${jobId}::uuid
    `
  }
}
