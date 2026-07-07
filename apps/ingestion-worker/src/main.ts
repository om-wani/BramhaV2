/**
 * Ingestion Worker — entry point.
 *
 * Starts a BullMQ Worker listening to the 'ingestion' queue.
 * Routes 'ingest.file' jobs through the SecurityGateProcessor.
 * Gracefully drains on SIGTERM / SIGINT.
 */

import { Worker, type Job } from 'bullmq'
import { Redis } from 'ioredis'
import { S3Client, GetObjectCommand, type GetObjectCommandOutput } from '@aws-sdk/client-s3'
import { Readable } from 'stream'
import { EventPublisher } from '@bramha/event-bus'
import { SecurityGateProcessor, type IngestFileJobData } from './security/security-gate.processor.js'
import { updateFileStatus } from './security/update-file-status.js'
import { quarantineFile } from './security/quarantine.js'
import { promoteFile } from './security/promote.js'
import { scanWithClamAv } from './security/steps/clamav-scan.js'
import { disarmImage } from './security/steps/disarm/image.js'
import { disarmPdf } from './security/steps/disarm/pdf.js'
import { disarmSvg } from './security/steps/disarm/svg.js'
import { disarmZip } from './security/steps/disarm/zip.js'
import { disarmCsv } from './security/steps/disarm/csv.js'
import { passthroughDisarm } from './security/steps/disarm/passthrough.js'
import type { Disarmer } from './security/security-gate.processor.js'

// ── Env validation ────────────────────────────────────────────────────────────

function requireEnv(key: string): string {
  // eslint-disable-next-line security/detect-object-injection
  const val = process.env[key]
  if (!val) throw new Error(`Missing required environment variable: ${key}`)
  return val
}

const REDIS_URL = requireEnv('REDIS_URL')
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

// ── Processor ─────────────────────────────────────────────────────────────────

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

  promoteFile: (cleanKey, buffer, storageKey, contentType) =>
    promoteFile(s3, {
      stagingBucket: S3_BUCKET_STAGING,
      cleanBucket: S3_BUCKET_CLEAN,
      storageKey,
      cleanKey,
      buffer,
      contentType,
    }),

  publisher,
  updateFileStatus,
  scanWithClamAv: (buf) => scanWithClamAv(buf),
  disarmers,
})

// ── BullMQ Worker ─────────────────────────────────────────────────────────────

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
    // Exponential backoff for ClamAV-down retries
    settings: {
      backoffStrategy: (attemptsMade: number) =>
        Math.min(1000 * Math.pow(2, attemptsMade - 1), 60_000),
    },
  },
)

worker.on('completed', (job: Job) => {
  console.log(JSON.stringify({ event: 'worker.job_completed', jobId: job.id }))
})

worker.on('failed', (job: Job | undefined, err: Error) => {
  console.error(
    JSON.stringify({ event: 'worker.job_failed', jobId: job?.id, err: err.message }),
  )
})

// ── Graceful shutdown ─────────────────────────────────────────────────────────

async function shutdown(signal: string) {
  console.log(JSON.stringify({ event: 'worker.shutdown', signal }))
  await worker.close()
  await redisWorker.quit()
  await redisPublisher.quit()
  process.exit(0)
}

process.on('SIGTERM', () => void shutdown('SIGTERM'))
process.on('SIGINT', () => void shutdown('SIGINT'))

console.log(JSON.stringify({ event: 'worker.started', queue: 'ingestion' }))
