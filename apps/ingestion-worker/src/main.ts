/**
 * Ingestion Worker — entry point.
 *
 * Starts two BullMQ Workers:
 *   1. 'ingestion' queue  → SecurityGateProcessor (ingest.file jobs)
 *   2. 'extraction' queue → ExtractionPipelineProcessor (extract.file jobs)
 *
 * The security gate enqueues an 'extract.file' job after marking a file clean.
 * Gracefully drains both workers on SIGTERM / SIGINT.
 */

import { Worker, Queue, type Job } from 'bullmq'
import { Redis } from 'ioredis'
import { S3Client, GetObjectCommand, type GetObjectCommandOutput } from '@aws-sdk/client-s3'
import { Readable } from 'stream'
import { EventPublisher } from '@bramha/event-bus'
import { createEmbeddingProvider } from '@bramha/agents'
import { SecurityGateProcessor, type IngestFileJobData } from './security/security-gate.processor.js'
import { updateFileStatus, updateFileStorageKey } from './security/update-file-status.js'
import { quarantineFile } from './security/quarantine.js'
import { promoteFile, deleteFromStaging } from './security/promote.js'
import { scanWithClamAv, checkClamAvHealth } from './security/steps/clamav-scan.js'
import { ClamAvDownError } from './security/errors.js'
import { disarmImage } from './security/steps/disarm/image.js'
import { disarmPdf } from './security/steps/disarm/pdf.js'
import { disarmSvg } from './security/steps/disarm/svg.js'
import { disarmZip } from './security/steps/disarm/zip.js'
import { disarmCsv } from './security/steps/disarm/csv.js'
import { passthroughDisarm } from './security/steps/disarm/passthrough.js'
import type { Disarmer } from './security/security-gate.processor.js'
import {
  ExtractionPipelineProcessor,
  type ExtractFileJobData,
} from './extraction-pipeline.processor.js'
import { NoteDeltaProcessor } from './note-delta.processor.js'
import { SourceSyncProcessor } from './sources/source-sync.processor.js'
import { sql } from './db.js'

// ── Env validation ────────────────────────────────────────────────────────────

function requireEnv(key: string): string {
  // eslint-disable-next-line security/detect-object-injection
  const val = process.env[key]
  if (!val) throw new Error(`Missing required environment variable: ${key}`)
  return val
}

const REDIS_URL = requireEnv('REDIS_URL')
const CREDENTIAL_ENCRYPTION_KEY = requireEnv('CREDENTIAL_ENCRYPTION_KEY')
const S3_ENDPOINT = requireEnv('S3_ENDPOINT')
const S3_BUCKET_STAGING = requireEnv('S3_BUCKET_STAGING')
const S3_BUCKET_CLEAN = requireEnv('S3_BUCKET_CLEAN')
const S3_BUCKET_QUARANTINE = requireEnv('S3_BUCKET_QUARANTINE')
const S3_ACCESS_KEY_ID = requireEnv('S3_ACCESS_KEY_ID')
const S3_SECRET_ACCESS_KEY = requireEnv('S3_SECRET_ACCESS_KEY')

// ── S3 client ─────────────────────────────────────────────────────────────────

const s3 = new S3Client({
  endpoint: S3_ENDPOINT,
  region: process.env['S3_REGION'] ?? 'us-east-1',
  credentials: {
    accessKeyId: S3_ACCESS_KEY_ID,
    secretAccessKey: S3_SECRET_ACCESS_KEY,
  },
  forcePathStyle: true, // Required for MinIO
})

// ── Redis clients ─────────────────────────────────────────────────────────────

const redisWorker = new Redis(REDIS_URL, { maxRetriesPerRequest: null })
const redisExtractionWorker = new Redis(REDIS_URL, { maxRetriesPerRequest: null })
const redisNoteDeltaWorker = new Redis(REDIS_URL, { maxRetriesPerRequest: null })
const redisSourceSyncWorker = new Redis(REDIS_URL, { maxRetriesPerRequest: null })
const redisPublisher = new Redis(REDIS_URL)
const publisher = new EventPublisher(redisPublisher)

// ── S3 helpers ────────────────────────────────────────────────────────────────

async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array))
  }
  return Buffer.concat(chunks as unknown as Uint8Array[])
}

async function downloadFile(storageKey: string): Promise<Buffer> {
  const response = (await s3.send(
    new GetObjectCommand({ Bucket: S3_BUCKET_STAGING, Key: storageKey }),
  )) as GetObjectCommandOutput
  if (!response.Body) throw new Error(`Empty S3 body for key: ${storageKey}`)
  return streamToBuffer(response.Body as Readable)
}

async function downloadCleanFile(storageKey: string): Promise<Buffer> {
  // Clean keys are stored without the 'clean/' prefix in the event payload
  // but the actual S3 key may include it. Normalise by stripping leading 'clean/'
  const key = storageKey.startsWith('clean/') ? storageKey.slice(6) : storageKey
  const response = (await s3.send(
    new GetObjectCommand({ Bucket: S3_BUCKET_CLEAN, Key: key }),
  )) as GetObjectCommandOutput
  if (!response.Body) throw new Error(`Empty S3 body for clean key: ${key}`)
  return streamToBuffer(response.Body as Readable)
}

// ── Extraction queue ──────────────────────────────────────────────────────────

// Shared Redis connection for queue enqueueing (not the worker connection)
const redisQueueConn = new Redis(REDIS_URL)
const extractionQueue = new Queue('extraction', {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  connection: redisQueueConn as any,
})

// ── Disarmer registry ─────────────────────────────────────────────────────────

const disarmers = new Map<string, Disarmer>([
  ['image/jpeg', disarmImage],
  ['image/png', disarmImage],
  ['image/webp', disarmImage],
  ['image/svg+xml', disarmSvg],
  ['application/pdf', disarmPdf],
  ['application/zip', disarmZip],
  ['text/csv', disarmCsv],
  ['text/plain', passthroughDisarm],
  ['text/markdown', passthroughDisarm],
  ['audio/mpeg', passthroughDisarm],
  ['video/mp4', passthroughDisarm],
  [
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    passthroughDisarm,
  ],
  [
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    passthroughDisarm,
  ],
])

// ── Security gate processor ───────────────────────────────────────────────────

const processor = new SecurityGateProcessor({
  downloadFile,

  quarantineFile: (storageKey, projectId, fileId) =>
    quarantineFile(s3, {
      stagingBucket: S3_BUCKET_STAGING,
      quarantineBucket: S3_BUCKET_QUARANTINE,
      storageKey,
      projectId,
      fileId,
    }),

  promoteFile: (cleanKey, buffer, _storageKey, contentType) =>
    promoteFile(s3, {
      cleanBucket: S3_BUCKET_CLEAN,
      cleanKey,
      buffer,
      contentType,
    }),

  deleteFromStaging: (storageKey) =>
    deleteFromStaging(s3, S3_BUCKET_STAGING, storageKey),

  publisher,
  updateFileStatus,
  updateFileStorageKey,
  scanWithClamAv: (buf) => scanWithClamAv(buf),
  disarmers,

  sql,

  // After marking file clean, enqueue extraction job
  onFileCleaned: async (data: IngestFileJobData, cleanKey: string) => {
    const jobData: ExtractFileJobData = {
      fileId: data.fileId,
      projectId: data.projectId,
      // storageKey for clean file (without 'clean/' prefix — downloadCleanFile normalises)
      storageKey: cleanKey,
      fileName: data.fileName,
      declaredMime: data.declaredMime,
    }
    await extractionQueue.add('extract.file', jobData, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 2_000 },
    })
    console.log(
      JSON.stringify({
        event: 'extraction.enqueued',
        fileId: data.fileId,
        projectId: data.projectId,
      }),
    )
  },
})

// ── Embedding provider ────────────────────────────────────────────────────────

// createEmbeddingProvider() throws 'no_embedding_provider' when neither
// OPENAI_API_KEY nor OLLAMA_EMBEDDING_MODEL is set. The extraction worker
// will fail each job with that error code rather than silently zero-embed.
let embeddingProvider: ReturnType<typeof createEmbeddingProvider> | null = null
try {
  embeddingProvider = createEmbeddingProvider()
} catch (err) {
  console.warn(
    JSON.stringify({
      event: 'embedding_provider.init_failed',
      reason: String(err),
    }),
  )
}

// ── Note delta processor ──────────────────────────────────────────────────────

const noteDeltaProcessor = new NoteDeltaProcessor({
  sql,
  publisher,
  // If no embedding provider is configured, pass a sentinel that throws
  // 'no_embedding_provider' so the job fails with a clear error code.
  embeddingProvider: embeddingProvider ?? {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    async embed(_: string[]) {
      throw new Error('no_embedding_provider')
    },
    dimension: 1536,
    model: 'no-op',
  },
})

// ── Source sync processor ─────────────────────────────────────────────────────

const sourceSyncProcessor = new SourceSyncProcessor({
  sql,
  publisher,
  embeddingProvider: embeddingProvider ?? {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    async embed(_: string[]) {
      throw new Error('no_embedding_provider')
    },
    dimension: 1536,
    model: 'no-op',
  },
  credentialEncryptionKey: CREDENTIAL_ENCRYPTION_KEY,
})

// ── Extraction pipeline processor ────────────────────────────────────────────

const extractionProcessor = new ExtractionPipelineProcessor({
  downloadCleanFile,
  sql,
  publisher,
  // If no embedding provider is configured, pass a sentinel that throws
  // 'no_embedding_provider' so the job fails with a clear error code.
  embeddingProvider: embeddingProvider ?? {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    async embed(_: string[]) {
      throw new Error('no_embedding_provider')
    },
    dimension: 1536,
    model: 'no-op',
  },
})

// ── BullMQ Workers ────────────────────────────────────────────────────────────

const noteDeltaWorker = new Worker(
  'note-delta',
  async (job: Job<unknown>) => {
    if (job.name !== 'note.delta') {
      console.log(JSON.stringify({ event: 'note_delta_worker.unknown_job', jobName: job.name }))
      return
    }
    await noteDeltaProcessor.process(job)
  },
  {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    connection: redisNoteDeltaWorker as any,
    concurrency: parseInt(process.env['NOTE_DELTA_CONCURRENCY'] ?? '5', 10),
  },
)

noteDeltaWorker.on('completed', (job: Job) => {
  console.log(JSON.stringify({ event: 'note_delta_worker.job_completed', jobId: job.id }))
})
noteDeltaWorker.on('failed', (job: Job | undefined, err: Error) => {
  console.error(JSON.stringify({ event: 'note_delta_worker.job_failed', jobId: job?.id, err: err.message }))
})

const worker = new Worker(
  'ingestion',
  async (job: Job<IngestFileJobData>) => {
    if (job.name !== 'ingest.file') {
      console.log(JSON.stringify({ event: 'worker.unknown_job', jobName: job.name }))
      return
    }
    await processor.process(job)
  },
  {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    connection: redisWorker as any,
    concurrency: parseInt(process.env['WORKER_CONCURRENCY'] ?? '5', 10),
    settings: {
      backoffStrategy: (attemptsMade: number) =>
        Math.min(1000 * Math.pow(2, attemptsMade - 1), 60_000),
    },
  },
)

const extractionWorker = new Worker(
  'extraction',
  async (job: Job<ExtractFileJobData>) => {
    if (job.name !== 'extract.file') {
      console.log(JSON.stringify({ event: 'extraction_worker.unknown_job', jobName: job.name }))
      return
    }
    await extractionProcessor.process(job)
  },
  {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    connection: redisExtractionWorker as any,
    concurrency: parseInt(process.env['EXTRACTION_CONCURRENCY'] ?? '3', 10),
  },
)

const sourceSyncWorker = new Worker(
  'source-sync',
  async (job: Job<unknown>) => {
    if (job.name !== 'source.sync') {
      console.log(JSON.stringify({ event: 'source_sync_worker.unknown_job', jobName: job.name }))
      return
    }
    await sourceSyncProcessor.process(job)
  },
  {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    connection: redisSourceSyncWorker as any,
    concurrency: parseInt(process.env['SOURCE_SYNC_CONCURRENCY'] ?? '2', 10),
  },)

worker.on('completed', (job: Job) => {
  console.log(JSON.stringify({ event: 'worker.job_completed', jobId: job.id }))
})

extractionWorker.on('completed', (job: Job) => {
  console.log(JSON.stringify({ event: 'extraction_worker.job_completed', jobId: job.id }))
})

// ── ClamAV down: pause worker and resume when daemon is back ──────────────────

let clamAvCheckInterval: NodeJS.Timeout | null = null

worker.on('failed', async (job: Job | undefined, err: Error) => {
  console.error(
    JSON.stringify({ event: 'worker.job_failed', jobId: job?.id, err: err.message }),
  )

  if (err instanceof ClamAvDownError && !clamAvCheckInterval) {
    console.error(JSON.stringify({ event: 'clamav.down.worker_paused' }))
    await worker.pause()
    clamAvCheckInterval = setInterval(async () => {
      try {
        await checkClamAvHealth()
        await worker.resume()
        clearInterval(clamAvCheckInterval!)
        clamAvCheckInterval = null
        console.log(JSON.stringify({ event: 'clamav.up.worker_resumed' }))
      } catch {
        // ClamAV still down — keep waiting
      }
    }, 15_000)
  }
})

extractionWorker.on('failed', (job: Job | undefined, err: Error) => {
  console.error(
    JSON.stringify({
      event: 'extraction_worker.job_failed',
      jobId: job?.id,
      err: err.message,
    }),
  )
})

sourceSyncWorker.on('completed', (job: Job) => {
  console.log(JSON.stringify({ event: 'source_sync_worker.job_completed', jobId: job.id }))
})
sourceSyncWorker.on('failed', (job: Job | undefined, err: Error) => {
  console.error(JSON.stringify({ event: 'source_sync_worker.job_failed', jobId: job?.id, err: err.message }))
})

// ── Graceful shutdown ─────────────────────────────────────────────────────────

async function shutdown(signal: string) {
  console.log(JSON.stringify({ event: 'worker.shutdown', signal }))
  await Promise.all([worker.close(), extractionWorker.close(), noteDeltaWorker.close(), sourceSyncWorker.close()])
  await Promise.all([
    redisWorker.quit(),
    redisExtractionWorker.quit(),
    redisNoteDeltaWorker.quit(),
    redisSourceSyncWorker.quit(),
    redisPublisher.quit(),
    redisQueueConn.quit(),
  ])
  process.exit(0)
}

process.on('SIGTERM', () => void shutdown('SIGTERM'))
process.on('SIGINT', () => void shutdown('SIGINT'))
process.on('unhandledRejection', (reason) => {
  console.error(JSON.stringify({ event: 'worker.unhandled_rejection', err: String(reason) }))
})

console.log(JSON.stringify({ event: 'worker.started', queues: ['ingestion', 'extraction', 'note-delta', 'source-sync'] }))
