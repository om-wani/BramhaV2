/**
 * SourceSyncProcessor — BullMQ processor for 'source-sync' queue.
 *
 * Receives SyncSourceJobData, decrypts credential, routes to the
 * appropriate sync strategy, tracks ingestion_jobs lifecycle.
 *
 * Events emitted:
 *   source.sync.started:{projectId}
 *   source.sync.completed:{projectId}
 *   source.sync.failed:{projectId}
 *
 * Security:
 *   - Raw credential NEVER logged
 *   - Error messages truncated to exclude any credential fragment
 */
import { createHash, createDecipheriv, createSecretKey } from 'node:crypto'
import type { Job } from 'bullmq'
import type postgres from 'postgres'
import type { EmbeddingProvider } from '@bramha/agents'
import { SyncSourceJobDataSchema } from '@bramha/shared'
import type { IPublisher } from '../security/security-gate.processor.js'
import { syncGitRepo } from './github-sync.js'
import { syncSqlDatabase } from './sql-sync.js'
import { syncUrl } from './url-sync.js'

// ── Credential decryption (mirrors API encryption) ────────────────────────────

const CRED_PREFIX = 'enc:v1:'

function deriveKey(rawKey: string) {
  const raw = createHash('sha256').update(rawKey).digest()
  return createSecretKey(new Uint8Array(raw))
}

function decryptCredential(credentialRef: string, encKey: string): string {
  if (!credentialRef.startsWith(CRED_PREFIX)) {
    throw new Error('invalid_credential_ref_format')
  }
  const secretKey = deriveKey(encKey)
  const payload = Buffer.from(credentialRef.slice(CRED_PREFIX.length), 'base64')
  // Layout: iv(12) || tag(16) || ciphertext — mirrors encryptCredential in API
  const iv = Uint8Array.from(payload.subarray(0, 12))
  const tag = Uint8Array.from(payload.subarray(12, 28))
  const encrypted = Uint8Array.from(payload.subarray(28))
  const decipher = createDecipheriv('aes-256-gcm', secretKey, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([Uint8Array.from(decipher.update(encrypted)), Uint8Array.from(decipher.final())]).toString('utf8')
}

// ── Channel helpers ───────────────────────────────────────────────────────────

function syncStartedChannel(projectId: string) { return `source.sync.started:${projectId}` }
function syncCompletedChannel(projectId: string) { return `source.sync.completed:${projectId}` }
function syncFailedChannel(projectId: string) { return `source.sync.failed:${projectId}` }

// ── Deps ──────────────────────────────────────────────────────────────────────

export interface SourceSyncProcessorDeps {
  sql: postgres.Sql
  publisher: IPublisher
  embeddingProvider: EmbeddingProvider
  credentialEncryptionKey: string
}

// ── Processor ─────────────────────────────────────────────────────────────────

export class SourceSyncProcessor {
  constructor(private readonly deps: SourceSyncProcessorDeps) {}

  async process(job: Job<unknown>): Promise<void> {
    const data = SyncSourceJobDataSchema.parse(job.data)
    const { projectId, sourceId, sourceType, config, credentialRef, triggeredBy } = data

    const log = (event: string, extra?: Record<string, unknown>) =>
      console.log(JSON.stringify({ event, projectId, sourceId, sourceType, ...extra }))

    let ingestionJobId: string | undefined

    try {
      // Step 1: Create ingestion_jobs row
      const inserted = await this.deps.sql<[{ id: string }]>`
        INSERT INTO ingestion_jobs (project_id, kind, source_id, status)
        VALUES (${projectId}::uuid, 'source_sync', ${sourceId}::uuid, 'queued')
        RETURNING id
      `
      ingestionJobId = inserted[0]?.id
      log('source_sync.started', { ingestionJobId, triggeredBy })

      // Update status → extracting
      if (ingestionJobId) {
        await this.updateJobStatus(ingestionJobId, 'extracting')
      }

      // Update knowledge_sources.last_sync_at, last_sync_status = 'running'
      await this.deps.sql`
        UPDATE knowledge_sources
        SET last_sync_at = NOW(), last_sync_status = 'running', updated_at = NOW()
        WHERE id = ${sourceId}::uuid
      `

      await this.deps.publisher.publish(syncStartedChannel(projectId), { projectId, sourceId, sourceType })

      // Step 2: Decrypt credential
      let credential: string | null = null
      if (credentialRef) {
        credential = decryptCredential(credentialRef, this.deps.credentialEncryptionKey)
      }

      // Step 3: Route to sync strategy
      let stats: Record<string, unknown>

      if (sourceType === 'github_repo' || sourceType === 'gitlab_repo') {
        const result = await syncGitRepo(
          projectId,
          sourceId,
          {
            repoUrl: (config['repoUrl'] as string) ?? '',
            branch: (config['branch'] as string) ?? 'main',
          },
          credential,
          { sql: this.deps.sql, embeddingProvider: this.deps.embeddingProvider },
        )
        stats = result as unknown as Record<string, unknown>
      } else if (sourceType === 'sql_database') {
        const sqlConfig: import('./sql-sync.js').SqlSyncConfig = {
          host: (config['host'] as string) ?? '',
          database: (config['database'] as string) ?? '',
          username: (config['username'] as string) ?? '',
        }
        const portVal = config['port']
        if (typeof portVal === 'number') sqlConfig.port = portVal
        const result = await syncSqlDatabase(
          projectId,
          sourceId,
          sqlConfig,
          credential,
          { sql: this.deps.sql, embeddingProvider: this.deps.embeddingProvider },
        )
        stats = result as unknown as Record<string, unknown>
      } else if (sourceType === 'url') {
        const urlConfig: import('./url-sync.js').UrlSyncConfig = {
          rootUrl: (config['rootUrl'] as string) ?? '',
        }
        const depthVal = config['maxDepth']
        const pagesVal = config['maxPages']
        if (typeof depthVal === 'number') urlConfig.maxDepth = depthVal
        if (typeof pagesVal === 'number') urlConfig.maxPages = pagesVal
        const result = await syncUrl(
          projectId,
          sourceId,
          urlConfig,
          { sql: this.deps.sql, embeddingProvider: this.deps.embeddingProvider },
        )
        stats = result as unknown as Record<string, unknown>
      } else {
        throw new Error(`unknown_source_type: ${sourceType}`)
      }

      // Step 4: Update ingestion_jobs → done
      if (ingestionJobId) {
        await this.deps.sql`
          UPDATE ingestion_jobs
          SET status = 'done', stats = ${JSON.stringify(stats)}::jsonb, updated_at = NOW()
          WHERE id = ${ingestionJobId}::uuid
        `
      }

      // Update knowledge_sources → last_sync_status = 'success'
      await this.deps.sql`
        UPDATE knowledge_sources
        SET last_sync_status = 'success', updated_at = NOW()
        WHERE id = ${sourceId}::uuid
      `

      await this.deps.publisher.publish(syncCompletedChannel(projectId), {
        projectId,
        sourceId,
        sourceType,
        stats,
      })

      log('source_sync.done', stats)
    } catch (err) {
      // Truncate error — ensure raw credential never leaks into logs/DB
      const rawReason = String(err)
      // Sanitize: remove anything that looks like base64 blob > 20 chars
      const reason = rawReason.replace(/[A-Za-z0-9+/=]{20,}/g, '[REDACTED]').slice(0, 500)

      console.error(JSON.stringify({ event: 'source_sync.failed', projectId, sourceId, err: reason }))

      if (ingestionJobId) {
        try {
          await this.deps.sql`
            UPDATE ingestion_jobs
            SET status = 'failed', error = ${reason}, updated_at = NOW()
            WHERE id = ${ingestionJobId}::uuid
          `
        } catch (dbErr) {
          console.error(JSON.stringify({ event: 'source_sync.db_update_failed', err: String(dbErr) }))
        }
      }

      // Update knowledge_sources → last_sync_status = 'failed'
      try {
        await this.deps.sql`
          UPDATE knowledge_sources
          SET last_sync_status = 'failed', updated_at = NOW()
          WHERE id = ${sourceId}::uuid
        `
      } catch {
        // best-effort
      }

      try {
        await this.deps.publisher.publish(syncFailedChannel(projectId), {
          projectId,
          sourceId,
          sourceType,
          reason,
        })
      } catch {
        // best-effort
      }

      throw err
    }
  }

  private async updateJobStatus(jobId: string, status: string): Promise<void> {
    await this.deps.sql`
      UPDATE ingestion_jobs
      SET status = ${status}, updated_at = NOW()
      WHERE id = ${jobId}::uuid
    `
  }
}
