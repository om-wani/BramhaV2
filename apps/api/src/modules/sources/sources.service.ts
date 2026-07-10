/**
 * SourcesService — CRUD for knowledge_sources + sync job dispatch.
 *
 * Security invariants:
 *   - Raw credentials NEVER stored in DB (AES-256-GCM encrypted → credential_ref)
 *   - credential_ref NEVER in any response (only hasCredential: boolean)
 *   - credential_ref NEVER logged
 */
import {
  Injectable,
  BadRequestException,
  NotFoundException,
  Logger,
  Inject,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import {
  createCipheriv,
  createDecipheriv,
  createSecretKey,
  randomBytes,
  createHash,
} from 'node:crypto'
import { Queue } from 'bullmq'
import type Redis from 'ioredis'
import type postgres from 'postgres'
import { RlsDbService } from '../common/db/rls-db.service'
import { REDIS_CLIENT } from '../common/redis/redis.module'
import type { CreateSourceInput, SourceResponse, SourceHistoryEntry, SyncSourceJobData } from '@bramha/shared'

// ── Encryption helpers (AES-256-GCM) ─────────────────────────────────────────

const CRED_PREFIX = 'enc:v1:'

function deriveKey(rawKey: string) {
  const raw = createHash('sha256').update(rawKey).digest()
  return createSecretKey(new Uint8Array(raw))
}

export function encryptCredential(rawCredential: string, encKey: string): string {
  const ivBuf = randomBytes(12)
  // Convert Buffer to Uint8Array<ArrayBuffer> for TS strict compatibility
  const iv = Uint8Array.from(ivBuf)
  const secretKey = deriveKey(encKey)
  const cipher = createCipheriv('aes-256-gcm', secretKey, iv)
  const encrypted = Buffer.concat([Uint8Array.from(cipher.update(rawCredential, 'utf8')), Uint8Array.from(cipher.final())])
  const tag = cipher.getAuthTag()
  // Format: enc:v1:<base64(iv || ciphertext || tag)>
  const payload = Buffer.concat([Uint8Array.from(ivBuf), Uint8Array.from(tag), Uint8Array.from(encrypted)])
  return `${CRED_PREFIX}${payload.toString('base64')}`
}

export function decryptCredential(credentialRef: string, encKey: string): string {
  if (!credentialRef.startsWith(CRED_PREFIX)) {
    throw new Error('invalid_credential_ref_format')
  }
  const secretKey = deriveKey(encKey)
  const payload = Buffer.from(credentialRef.slice(CRED_PREFIX.length), 'base64')
  // Layout: iv(12) || tag(16) || ciphertext
  const iv = Uint8Array.from(payload.subarray(0, 12))
  const tag = Uint8Array.from(payload.subarray(12, 28))
  const encrypted = Uint8Array.from(payload.subarray(28))
  const decipher = createDecipheriv('aes-256-gcm', secretKey, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([Uint8Array.from(decipher.update(encrypted)), Uint8Array.from(decipher.final())]).toString('utf8')
}

// ── DB row types ──────────────────────────────────────────────────────────────

interface SourceRow {
  id: string
  project_id: string
  type: string
  config: Record<string, unknown>
  credential_ref: string | null
  sync_schedule: string | null
  last_sync_at: string | null
  last_sync_status: string | null
  created_at: string
  updated_at: string
}

interface JobRow {
  id: string
  source_id: string | null
  status: string
  stats: Record<string, unknown> | null
  error: string | null
  created_at: string
  updated_at: string
}

// ── Mapper — NEVER includes credential_ref ────────────────────────────────────

function mapSource(row: SourceRow): SourceResponse {
  return {
    id: row.id,
    projectId: row.project_id,
    type: row.type,
    config: row.config,
    hasCredential: row.credential_ref !== null && row.credential_ref !== '',
    syncSchedule: row.sync_schedule,
    lastSyncAt: row.last_sync_at,
    lastSyncStatus: row.last_sync_status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function mapHistoryEntry(row: JobRow): SourceHistoryEntry {
  return {
    id: row.id,
    sourceId: row.source_id,
    status: row.status,
    stats: row.stats,
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

type Tx = postgres.TransactionSql

// ── Service ───────────────────────────────────────────────────────────────────

@Injectable()
export class SourcesService {
  private readonly logger = new Logger(SourcesService.name)
  private readonly sourceSyncQueue: Queue

  constructor(
    private readonly db: RlsDbService,
    private readonly config: ConfigService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {
    this.sourceSyncQueue = new Queue('source-sync', {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      connection: redis as any,
    })
  }

  // ── createSource ────────────────────────────────────────────────────────────

  async createSource(
    userId: string,
    projectId: string,
    input: CreateSourceInput,
  ): Promise<SourceResponse> {
    // Encrypt credential at the boundary — NEVER store raw
    let credentialRef: string | null = null
    if (input.credential) {
      const encKey = this.config.get<string>('CREDENTIAL_ENCRYPTION_KEY')
      if (!encKey) {
        throw new BadRequestException({
          code: 'encryption_key_not_configured',
          message: 'Server is not configured to accept credentials',
        })
      }
      credentialRef = encryptCredential(input.credential, encKey)
    }

    // Strip credential from config — config must NEVER contain raw creds
    const safeConfig = { ...input.config } as Record<string, unknown>
    delete safeConfig['password']
    delete safeConfig['credential']
    delete safeConfig['secret']

    const rows = await this.db.run({ userId, projectId }, async (tx: Tx) => {
      return tx<SourceRow[]>`
        INSERT INTO knowledge_sources
          (project_id, type, config, credential_ref, sync_schedule)
        VALUES (
          ${projectId}::uuid,
          ${input.type},
          ${JSON.stringify(safeConfig)}::jsonb,
          ${credentialRef},
          ${input.syncSchedule ?? null}
        )
        RETURNING id, project_id, type, config, credential_ref, sync_schedule,
                  last_sync_at, last_sync_status, created_at, updated_at
      `
    })

    if (!rows[0]) throw new BadRequestException({ code: 'source_creation_failed' })

    this.logger.log({ event: 'source.created', actorId: userId, projectId, sourceId: rows[0].id, type: input.type })

    return mapSource(rows[0])
  }

  // ── listSources ─────────────────────────────────────────────────────────────

  async listSources(userId: string, projectId: string): Promise<SourceResponse[]> {
    const rows = await this.db.run({ userId, projectId }, async (tx: Tx) => {
      return tx<SourceRow[]>`
        SELECT id, project_id, type, config, credential_ref, sync_schedule,
               last_sync_at, last_sync_status, created_at, updated_at
        FROM knowledge_sources
        WHERE project_id = ${projectId}::uuid
        ORDER BY created_at DESC
      `
    })
    return rows.map(mapSource)
  }

  // ── getSource ───────────────────────────────────────────────────────────────

  async getSource(userId: string, projectId: string, sourceId: string): Promise<SourceResponse> {
    const rows = await this.db.run({ userId, projectId }, async (tx: Tx) => {
      return tx<SourceRow[]>`
        SELECT id, project_id, type, config, credential_ref, sync_schedule,
               last_sync_at, last_sync_status, created_at, updated_at
        FROM knowledge_sources
        WHERE id = ${sourceId}::uuid AND project_id = ${projectId}::uuid
      `
    })
    if (!rows[0]) throw new NotFoundException({ code: 'source_not_found' })
    return mapSource(rows[0])
  }

  // ── deleteSource ─────────────────────────────────────────────────────────────

  async deleteSource(userId: string, projectId: string, sourceId: string): Promise<void> {
    const deleted = await this.db.run({ userId, projectId }, async (tx: Tx) => {
      return tx<{ id: string }[]>`
        DELETE FROM knowledge_sources
        WHERE id = ${sourceId}::uuid AND project_id = ${projectId}::uuid
        RETURNING id
      `
    })
    if (!deleted[0]) throw new NotFoundException({ code: 'source_not_found' })

    // Cancel pending sync jobs (best-effort — BullMQ doesn't support selective cancel easily)
    try {
      const jobs = await this.sourceSyncQueue.getJobs(['waiting', 'delayed'])
      for (const job of jobs) {
        const data = job.data as { sourceId?: string }
        if (data?.sourceId === sourceId) {
          await job.remove()
        }
      }
    } catch (err) {
      this.logger.warn({ event: 'source.delete_cancel_jobs_failed', sourceId, err: String(err) })
    }

    this.logger.log({ event: 'source.deleted', actorId: userId, projectId, sourceId })
  }

  // ── triggerSync ──────────────────────────────────────────────────────────────

  async triggerSync(userId: string, projectId: string, sourceId: string): Promise<{ jobId: string }> {
    // Fetch source to get type, config, credentialRef
    const rows = await this.db.run({ userId, projectId }, async (tx: Tx) => {
      return tx<SourceRow[]>`
        SELECT id, project_id, type, config, credential_ref, sync_schedule,
               last_sync_at, last_sync_status, created_at, updated_at
        FROM knowledge_sources
        WHERE id = ${sourceId}::uuid AND project_id = ${projectId}::uuid
      `
    })
    if (!rows[0]) throw new NotFoundException({ code: 'source_not_found' })

    const source = rows[0]

    const jobData: SyncSourceJobData = {
      projectId,
      sourceId,
      sourceType: source.type as SyncSourceJobData['sourceType'],
      config: source.config,
      credentialRef: source.credential_ref,
      triggeredBy: userId,
    }

    const job = await this.sourceSyncQueue.add('source.sync', jobData, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5_000 },
    })

    this.logger.log({ event: 'source.sync_triggered', actorId: userId, projectId, sourceId, jobId: job.id })

    return { jobId: job.id! }
  }

  // ── getHistory ───────────────────────────────────────────────────────────────

  async getHistory(userId: string, projectId: string, sourceId: string): Promise<SourceHistoryEntry[]> {
    // Verify source exists and belongs to project
    const sourceRows = await this.db.run({ userId, projectId }, async (tx: Tx) => {
      return tx<{ id: string }[]>`
        SELECT id FROM knowledge_sources
        WHERE id = ${sourceId}::uuid AND project_id = ${projectId}::uuid
      `
    })
    if (!sourceRows[0]) throw new NotFoundException({ code: 'source_not_found' })

    const rows = await this.db.run({ userId, projectId }, async (tx: Tx) => {
      return tx<JobRow[]>`
        SELECT id, source_id, status, stats, error, created_at, updated_at
        FROM ingestion_jobs
        WHERE kind = 'source_sync'
          AND source_id = ${sourceId}::uuid
          AND project_id = ${projectId}::uuid
        ORDER BY created_at DESC
        LIMIT 50
      `
    })

    return rows.map(mapHistoryEntry)
  }
}
