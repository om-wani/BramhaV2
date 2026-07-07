import {
  Injectable,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  HttpException,
  HttpStatus,
  Inject,
  Logger,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { extname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { Queue } from 'bullmq'
import type Redis from 'ioredis'
import type postgres from 'postgres'
import { RlsDbService } from '../common/db/rls-db.service'
import { S3_CLIENT, S3_BUCKET } from '../common/s3/s3.module'
import { REDIS_CLIENT } from '../common/redis/redis.module'
import type { InitiateUploadInput, FileDto, ScanStatus } from '@bramha/shared'

// ── Allowlists ────────────────────────────────────────────────────────────────

const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/markdown',
  'text/plain',
  'text/csv',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'image/png',
  'image/jpeg',
  'image/webp',
  'audio/mpeg',
  'video/mp4',
  'application/zip',
])

const ALLOWED_EXTENSIONS = new Set([
  '.pdf',
  '.docx',
  '.md',
  '.txt',
  '.csv',
  '.xlsx',
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.mp3',
  '.mp4',
  '.zip',
])

// ── Constants ──────────────────────────────────────────────────────────────────

const UPLOAD_TTL_SECONDS = 60
const DOWNLOAD_TTL_SECONDS = 15 * 60
const DEFAULT_MAX_PROJECT_STORAGE_MB = 500
const RATE_LIMIT_PER_HOUR = 10

// ── Row types ──────────────────────────────────────────────────────────────────

interface FileRow {
  id: string
  project_id: string
  uploaded_by: string
  room_id: string | null
  name: string
  declared_mime: string
  detected_mime: string | null
  size_bytes: string // bigint comes back as string from postgres
  storage_key: string
  scan_status: string
  scan_report: unknown
  created_at: string
  updated_at: string
}

// ── Mapper ────────────────────────────────────────────────────────────────────

function mapFile(r: FileRow): FileDto {
  return {
    id: r.id,
    projectId: r.project_id,
    uploadedBy: r.uploaded_by,
    roomId: r.room_id,
    name: r.name,
    declaredMime: r.declared_mime,
    detectedMime: r.detected_mime,
    sizeBytes: Number(r.size_bytes),
    storageKey: r.storage_key,
    scanStatus: r.scan_status as ScanStatus,
    scanReport: r.scan_report,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

type Tx = postgres.TransactionSql

@Injectable()
export class FilesService {
  private readonly logger = new Logger(FilesService.name)
  private readonly ingestionQueue: Queue

  constructor(
    private readonly db: RlsDbService,
    private readonly config: ConfigService,
    @Inject(S3_CLIENT) private readonly s3: S3Client,
    @Inject(S3_BUCKET) private readonly bucket: string,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {
    this.ingestionQueue = new Queue('ingestion', {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      connection: redis as any,
    })
  }

  // ── Initiate upload ────────────────────────────────────────────────────────

  async initiateUpload(
    userId: string,
    projectId: string,
    input: InitiateUploadInput,
  ): Promise<{ fileId: string; uploadUrl: string; key: string; expiresAt: string }> {
    // 1. MIME allowlist
    if (!ALLOWED_MIME_TYPES.has(input.declaredMime)) {
      throw new BadRequestException({ code: 'mime_not_allowed', message: 'MIME type not allowed' })
    }

    // 2. Extension allowlist
    const ext = extname(input.name).toLowerCase()
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      throw new BadRequestException({ code: 'extension_not_allowed', message: 'File extension not allowed' })
    }

    // 3. Rate limit: RATE_LIMIT_PER_HOUR uploads per user per hour (atomic pipeline)
    const hourKey = Math.floor(Date.now() / 3_600_000)
    const rateLimitKey = `file:ratelimit:${userId}:${hourKey}`
    const endOfHour = (hourKey + 1) * 3600
    const pipelineResult = await this.redis
      .pipeline()
      .incr(rateLimitKey)
      .expireat(rateLimitKey, endOfHour)
      .exec()
    const count = (pipelineResult?.[0]?.[1] as number) ?? 0
    if (count > RATE_LIMIT_PER_HOUR) {
      throw new HttpException({ code: 'rate_limit_exceeded' }, HttpStatus.TOO_MANY_REQUESTS)
    }

    // 4+5+7. Generate IDs then quota-check + insert atomically in one transaction
    const maxBytes =
      Number(this.config.get<number>('MAX_PROJECT_STORAGE_MB', DEFAULT_MAX_PROJECT_STORAGE_MB)) *
      1024 *
      1024
    const fileId = randomUUID()
    const key = `staging/${projectId}/${fileId}`

    await this.db.run({ userId, projectId }, async (tx: Tx) => {
      // Quota check inside the same transaction to prevent TOCTOU races
      const quotaRows = await tx<{ total: string }[]>`
        SELECT COALESCE(SUM(size_bytes), 0)::text AS total
        FROM files
        WHERE project_id = ${projectId}::uuid
      `
      const usedBytes = Number(quotaRows[0]?.total ?? 0)
      if (usedBytes + input.sizeBytes > maxBytes) {
        throw new BadRequestException({ code: 'project_quota_exceeded', message: 'Project storage quota exceeded' })
      }

      await tx`
        INSERT INTO files (id, project_id, uploaded_by, room_id, name, declared_mime, size_bytes, storage_key, scan_status)
        VALUES (
          ${fileId}::uuid,
          ${projectId}::uuid,
          ${userId}::uuid,
          ${input.roomId ?? null},
          ${input.name},
          ${input.declaredMime},
          ${input.sizeBytes},
          ${key},
          'pending'
        )
      `
    })

    // 8. Generate presigned PUT URL
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: input.declaredMime,
      ContentLength: input.sizeBytes,
    })
    const uploadUrl = await getSignedUrl(this.s3, command, { expiresIn: UPLOAD_TTL_SECONDS })
    const expiresAt = new Date(Date.now() + UPLOAD_TTL_SECONDS * 1000).toISOString()

    this.logger.log({ event: 'file.upload_initiated', actorId: userId, fileId, projectId })

    return { fileId, uploadUrl, key, expiresAt }
  }

  // ── Confirm upload ─────────────────────────────────────────────────────────

  async confirmUpload(userId: string, projectId: string, fileId: string): Promise<FileDto> {
    // 1. Atomically transition 'pending' → 'scanning' (idempotency guard prevents double-ingestion)
    const updated = await this.db.run({ userId, projectId }, async (tx: Tx) => {
      return tx<FileRow[]>`
        UPDATE files
        SET scan_status = 'scanning', updated_at = now()
        WHERE id = ${fileId}::uuid AND project_id = ${projectId}::uuid AND scan_status = 'pending'
        RETURNING id, project_id, uploaded_by, room_id, name, declared_mime, detected_mime,
                  size_bytes::text AS size_bytes, storage_key, scan_status, scan_report, created_at, updated_at
      `
    })

    if (!updated[0]) {
      // No rows updated: either file not found or already past 'pending'.
      // Distinguish by checking existence so we return the correct error.
      const existing = await this.db.run({ userId, projectId }, async (tx: Tx) => {
        return tx<{ id: string }[]>`
          SELECT id FROM files WHERE id = ${fileId}::uuid AND project_id = ${projectId}::uuid
        `
      })
      if (!existing[0]) throw new NotFoundException({ code: 'file_not_found' })
      // Already scanning/clean/etc — idempotent: return current state
      return this.getFile(userId, projectId, fileId)
    }

    // 2. Enqueue BullMQ job only after DB transition succeeds
    await this.ingestionQueue.add('ingest.file', {
      fileId,
      projectId,
      storageKey: updated[0].storage_key,
    })

    this.logger.log({ event: 'file.confirm_upload', actorId: userId, fileId, projectId })

    return mapFile(updated[0])
  }

  // ── Get file ───────────────────────────────────────────────────────────────

  async getFile(userId: string, projectId: string, fileId: string): Promise<FileDto> {
    const rows = await this.db.run({ userId, projectId }, async (tx: Tx) => {
      return tx<FileRow[]>`
        SELECT id, project_id, uploaded_by, room_id, name, declared_mime, detected_mime,
               size_bytes::text AS size_bytes, storage_key, scan_status, scan_report, created_at, updated_at
        FROM files
        WHERE id = ${fileId}::uuid AND project_id = ${projectId}::uuid
      `
    })
    if (!rows[0]) throw new NotFoundException({ code: 'file_not_found' })
    return mapFile(rows[0])
  }

  // ── List files ─────────────────────────────────────────────────────────────

  async listFiles(userId: string, projectId: string): Promise<FileDto[]> {
    const rows = await this.db.run({ userId, projectId }, async (tx: Tx) => {
      return tx<FileRow[]>`
        SELECT id, project_id, uploaded_by, room_id, name, declared_mime, detected_mime,
               size_bytes::text AS size_bytes, storage_key, scan_status, scan_report, created_at, updated_at
        FROM files
        WHERE project_id = ${projectId}::uuid
        ORDER BY created_at DESC
      `
    })
    return rows.map(mapFile)
  }

  // ── Get download URL ───────────────────────────────────────────────────────

  async getDownloadUrl(
    userId: string,
    projectId: string,
    fileId: string,
  ): Promise<{ url: string }> {
    const file = await this.getFile(userId, projectId, fileId)
    if (file.scanStatus !== 'clean') {
      throw new ForbiddenException({ code: 'file_not_clean', message: 'File is not clean and cannot be downloaded' })
    }

    const command = new GetObjectCommand({ Bucket: this.bucket, Key: file.storageKey })
    const url = await getSignedUrl(this.s3, command, { expiresIn: DOWNLOAD_TTL_SECONDS })

    return { url }
  }
}
