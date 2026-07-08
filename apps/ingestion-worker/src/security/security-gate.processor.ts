import { basename } from 'node:path'
import type { Job } from 'bullmq'
import type { ScanStatus } from '@bramha/shared'
import {
  FileCleanPayloadSchema,
  FileQuarantinedPayloadSchema,
  FileFailedPayloadSchema,
} from '@bramha/shared'
import { checkMagic } from './steps/magic-check.js'
import { checkSize } from './steps/size-check.js'
import { checkAllowlist, PASSTHROUGH_MIMES } from './steps/allowlist-check.js'
import { ClamAvDownError } from './errors.js'
import type { ClamAvResult } from './steps/clamav-scan.js'
import { IngestFileJobDataSchema } from '../types.js'
import type { IngestFileJobData } from '../types.js'
export type { IngestFileJobData } from '../types.js'

// ── Types ────────────────────────────────────────────────────────────────────

/** Function signature for per-type disarmers. */
export type Disarmer = (buffer: Buffer, mime: string) => Promise<Buffer>

/** Minimal publisher interface (compatible with EventPublisher). */
export interface IPublisher {
  publish(channel: string, payload: unknown): Promise<void>
}

export interface SecurityGateDeps {
  /** Download a file from staging storage → Buffer. */
  downloadFile: (storageKey: string) => Promise<Buffer>

  /** Move the file from staging → quarantine bucket. */
  quarantineFile: (storageKey: string, projectId: string, fileId: string) => Promise<void>

  /**
   * Write disarmed buffer to clean bucket (PutObject only — no staging delete).
   * The staging delete is handled separately by deleteFromStaging() AFTER the
   * DB has been committed to 'clean'.
   *
   * storageKey is the original staging key, passed so concrete implementations
   * can use it for logging or deduplication if needed.
   */
  promoteFile: (
    cleanKey: string,
    buffer: Buffer,
    storageKey: string,
    contentType: string,
  ) => Promise<void>

  /**
   * Delete the original file from staging (best-effort, called after DB commit).
   * If this throws, the stale staging object is harmless and can be cleaned up
   * by a background sweep.
   *
   * Optional: if not provided (e.g. in tests), the staging delete step is skipped.
   */
  deleteFromStaging?: (storageKey: string) => Promise<void>

  /** Redis event publisher. */
  publisher: IPublisher

  /** Write scan_status + scan_report to the files table. */
  updateFileStatus: (
    fileId: string,
    status: ScanStatus,
    report: Record<string, unknown>,
  ) => Promise<void>

  /**
   * Run ClamAV scan on the buffer.
   * Must throw ClamAvDownError if the daemon is unreachable.
   */
  scanWithClamAv: (buffer: Buffer) => Promise<ClamAvResult>

  /**
   * Optional disarmer overrides, keyed by MIME type or prefix.
   * Keys checked (in order): exact MIME, 'image/' prefix for image/* types.
   * Falls back to built-in defaults when not provided.
   */
  disarmers?: Map<string, Disarmer> | undefined

  /** Override default max file size (bytes). Defaults to MAX_FILE_BYTES env. */
  maxFileBytes?: number | undefined

  /**
   * Optional hook called after a file has been promoted to the clean bucket
   * and the DB status committed to 'clean'. Use this to enqueue downstream
   * processing (e.g., extraction pipeline).
   *
   * Errors thrown here are logged but do NOT fail the security gate job —
   * the clean status is already committed at this point.
   */
  onFileCleaned?: (data: IngestFileJobData, cleanKey: string) => Promise<void>
}

// ── Channel helpers ──────────────────────────────────────────────────────────

function cleanChannel(projectId: string) {
  return `ingest.file.clean:${projectId}`
}
function quarantinedChannel(projectId: string) {
  return `ingest.file.quarantined:${projectId}`
}
function failedChannel(projectId: string) {
  return `ingest.file.failed:${projectId}`
}

// ── Disarmer selection ───────────────────────────────────────────────────────

/**
 * Import the default disarmers lazily to avoid pulling external packages
 * into test contexts. main.ts pre-wires the full disarmer map.
 */
async function getDefaultDisarmer(mime: string): Promise<Disarmer> {
  if (mime === 'image/svg+xml') {
    const { disarmSvg } = await import('./steps/disarm/svg.js')
    return disarmSvg
  }
  if (mime.startsWith('image/')) {
    const { disarmImage } = await import('./steps/disarm/image.js')
    return disarmImage
  }
  if (mime === 'application/pdf') {
    const { disarmPdf } = await import('./steps/disarm/pdf.js')
    return disarmPdf
  }
  if (mime === 'application/zip') {
    const { disarmZip } = await import('./steps/disarm/zip.js')
    return disarmZip
  }
  if (mime === 'text/csv') {
    const { disarmCsv } = await import('./steps/disarm/csv.js')
    return disarmCsv
  }
  const { passthroughDisarm } = await import('./steps/disarm/passthrough.js')
  return passthroughDisarm
}

function resolveDisarmer(mime: string, overrides?: Map<string, Disarmer>): Disarmer | null {
  if (!overrides) return null

  // Exact match first
  if (overrides.has(mime)) return overrides.get(mime)!

  // Prefix match for image types (covers image/jpeg, image/png etc.)
  if (mime.startsWith('image/') && overrides.has('image/')) {
    return overrides.get('image/')!
  }

  return null
}

// ── Processor ────────────────────────────────────────────────────────────────

/**
 * SecurityGateProcessor — ordered fail-closed gate for file ingestion.
 *
 * Gate order:
 *   0. Job payload validation (Zod)
 *   1. Size check         → fail → UPDATE failed, emit failed, ack
 *   2. S3 download
 *   3. Magic-byte check   → fail → quarantine, UPDATE quarantined, emit, ack
 *   4. Allowlist check    → fail → quarantine, UPDATE quarantined, emit, ack
 *   5. ClamAV scan        → virus → quarantine, UPDATE, emit; DOWN → THROW (retry)
 *   6. Per-type disarm    → fail → quarantine, UPDATE quarantined, emit, ack
 *   7. Promote to clean   → PUT to clean bucket (no staging delete yet)
 *   8. UPDATE clean, emit clean
 *   9. Delete from staging (best-effort; failure is acceptable)
 *
 * Ordering invariant (race-condition fix): the DB status is committed to
 * 'clean' (step 8) BEFORE the staging object is deleted (step 9). If a
 * crash occurs between 7 and 8, the file is in the clean bucket but the DB
 * still shows 'scanning'. A BullMQ retry will re-download from staging
 * (still present), re-process, and complete correctly. If a crash occurs
 * between 8 and 9, the staging object is stale but harmless — a background
 * cleanup sweep can remove it.
 *
 * Any unexpected exception (except ClamAvDownError) is caught, the file is
 * quarantined (if downloaded) or failed, and the job is acked to prevent
 * infinite loops.
 */
export class SecurityGateProcessor {
  constructor(private readonly deps: SecurityGateDeps) {}

  async process(job: Job<unknown>): Promise<void> {
    // ── Step 0: Validate job payload ─────────────────────────────────────────
    // Throw on invalid payload — BullMQ moves the job to the failed set.
    // We cannot update the DB without a valid fileId.
    const { fileId, projectId, storageKey, declaredMime, fileName, sizeBytes } =
      IngestFileJobDataSchema.parse(job.data)

    // Sanitize fileName to prevent path traversal in S3 clean key
    const safeFileName = basename(fileName).replace(/[^a-zA-Z0-9._-]/g, '_')

    const log = (event: string, extra?: Record<string, unknown>) =>
      console.log(JSON.stringify({ event, fileId, projectId, ...extra }))

    let fileBuffer: Buffer | undefined

    try {
      // ── Step 1: Size check (no S3 needed) ──────────────────────────────────
      const sizeResult = checkSize(sizeBytes, this.deps.maxFileBytes)
      if (!sizeResult.ok) {
        log('security.gate.size_fail', { sizeBytes })
        await this.deps.updateFileStatus(fileId, 'failed', { reason: 'file_too_large', sizeBytes })
        const failPayload = { fileId, projectId, reason: 'file_too_large' }
        FileFailedPayloadSchema.parse(failPayload)
        await this.deps.publisher.publish(failedChannel(projectId), failPayload)
        return
      }

      // ── Step 2: Download from staging ────────────────────────────────────
      log('security.gate.downloading')
      try {
        fileBuffer = await this.deps.downloadFile(storageKey)
      } catch (downloadErr) {
        log('security.gate.download_error', { err: String(downloadErr) })
        await this.deps.updateFileStatus(fileId, 'failed', { reason: 's3_download_error' })
        const failPayload = { fileId, projectId, reason: 's3_download_error' }
        FileFailedPayloadSchema.parse(failPayload)
        await this.deps.publisher.publish(failedChannel(projectId), failPayload)
        return
      }

      // ── Step 3: Magic-byte check ─────────────────────────────────────────
      const magicResult = await checkMagic(fileBuffer, declaredMime)
      if (!magicResult.ok) {
        log('security.gate.magic_fail', {
          declaredMime,
          detectedMime: magicResult.detectedMime,
          reason: magicResult.reason,
        })
        await this.deps.quarantineFile(storageKey, projectId, fileId)
        await this.deps.updateFileStatus(fileId, 'quarantined', {
          reason: magicResult.reason ?? 'mime_mismatch',
          declaredMime,
          detectedMime: magicResult.detectedMime,
        })
        const quarPayload = { fileId, projectId, reason: magicResult.reason ?? 'mime_mismatch' }
        FileQuarantinedPayloadSchema.parse(quarPayload)
        await this.deps.publisher.publish(quarantinedChannel(projectId), quarPayload)
        return
      }

      // ── Step 4: Allowlist check ──────────────────────────────────────────
      const allowlistResult = checkAllowlist(declaredMime)
      if (!allowlistResult.ok) {
        log('security.gate.allowlist_fail', { declaredMime })
        await this.deps.quarantineFile(storageKey, projectId, fileId)
        await this.deps.updateFileStatus(fileId, 'quarantined', {
          reason: 'mime_not_allowed',
          declaredMime,
        })
        const quarPayload = { fileId, projectId, reason: 'mime_not_allowed' }
        FileQuarantinedPayloadSchema.parse(quarPayload)
        await this.deps.publisher.publish(quarantinedChannel(projectId), quarPayload)
        return
      }

      // ── Step 5: ClamAV scan ──────────────────────────────────────────────
      // NOTE: ClamAvDownError propagates to the outer catch and is rethrown.
      // Never quarantine or mark clean when the scanner is unreachable.
      log('security.gate.scanning')
      const scanResult = await this.deps.scanWithClamAv(fileBuffer)

      if (scanResult.verdict === 'virus') {
        log('security.gate.virus_found', { threatName: scanResult.threatName })
        await this.deps.quarantineFile(storageKey, projectId, fileId)
        await this.deps.updateFileStatus(fileId, 'quarantined', {
          reason: 'virus_found',
          threatName: scanResult.threatName,
        })
        const quarPayload = { fileId, projectId, reason: 'virus_found', threatName: scanResult.threatName }
        FileQuarantinedPayloadSchema.parse(quarPayload)
        await this.deps.publisher.publish(quarantinedChannel(projectId), quarPayload)
        return
      }

      // ── Step 6: Disarm ───────────────────────────────────────────────────
      log('security.gate.disarming', { declaredMime })
      const disarmerFn =
        resolveDisarmer(declaredMime, this.deps.disarmers) ??
        (await getDefaultDisarmer(declaredMime))

      let disarmedBuffer: Buffer
      try {
        disarmedBuffer = await disarmerFn(fileBuffer, declaredMime)
      } catch (disarmErr) {
        log('security.gate.disarm_fail', { declaredMime, err: String(disarmErr) })
        await this.deps.quarantineFile(storageKey, projectId, fileId)
        await this.deps.updateFileStatus(fileId, 'quarantined', {
          reason: 'disarm_failed',
          declaredMime,
          error: String(disarmErr),
        })
        const quarPayload = { fileId, projectId, reason: 'disarm_failed' }
        FileQuarantinedPayloadSchema.parse(quarPayload)
        await this.deps.publisher.publish(quarantinedChannel(projectId), quarPayload)
        return
      }

      // ── Step 7: Promote to clean bucket (PutObject only) ─────────────────
      const cleanKey = `${projectId}/${fileId}/${safeFileName}`
      log('security.gate.promoting', { cleanKey })
      await this.deps.promoteFile(cleanKey, disarmedBuffer, storageKey, declaredMime)

      // ── Step 8: Commit DB status + emit event (BEFORE staging delete) ─────
      const wasDisarmed = !PASSTHROUGH_MIMES.has(declaredMime)
      const scanReport = { verdict: 'clean' as const, disarmed: wasDisarmed }

      await this.deps.updateFileStatus(fileId, 'clean', scanReport)

      const cleanPayload = { fileId, projectId, storageKey: `clean/${cleanKey}`, scanReport }
      FileCleanPayloadSchema.parse(cleanPayload)
      await this.deps.publisher.publish(cleanChannel(projectId), cleanPayload)

      log('security.gate.clean', { disarmed: wasDisarmed })

      // ── Step 9: Delete from staging (best-effort) ─────────────────────────
      // DB is committed and event emitted. A stale staging object is harmless.
      try {
        if (this.deps.deleteFromStaging) {
          await this.deps.deleteFromStaging(storageKey)
        }
      } catch (deleteErr) {
        log('security.gate.staging_delete_failed', { err: String(deleteErr) })
      }

      // ── Step 10: Trigger downstream extraction (best-effort) ───────────────
      // DB is clean, event emitted. Extraction failure is handled independently.
      if (this.deps.onFileCleaned) {
        try {
          await this.deps.onFileCleaned(
            IngestFileJobDataSchema.parse(job.data),
            cleanKey,
          )
        } catch (hookErr) {
          log('security.gate.on_file_cleaned_failed', { err: String(hookErr) })
        }
      }
    } catch (err) {
      // ── ClamAV down: rethrow so BullMQ retries ───────────────────────────
      if (err instanceof ClamAvDownError) {
        console.error(
          JSON.stringify({ event: 'clamav.down', fileId, projectId, err: String(err) }),
        )
        throw err
      }

      // ── Unexpected error: fail gracefully, ack the job ───────────────────
      console.error(
        JSON.stringify({
          event: 'security.gate.unexpected_error',
          fileId,
          projectId,
          err: String(err),
        }),
      )

      try {
        if (fileBuffer !== undefined) {
          await this.deps.quarantineFile(storageKey, projectId, fileId)
          await this.deps.updateFileStatus(fileId, 'quarantined', { reason: 'unexpected_error' })
          const quarPayload = { fileId, projectId, reason: 'unexpected_error' }
          FileQuarantinedPayloadSchema.parse(quarPayload)
          await this.deps.publisher.publish(quarantinedChannel(projectId), quarPayload)
        } else {
          await this.deps.updateFileStatus(fileId, 'failed', { reason: 'unexpected_error' })
          const failPayload = { fileId, projectId, reason: 'unexpected_error' }
          FileFailedPayloadSchema.parse(failPayload)
          await this.deps.publisher.publish(failedChannel(projectId), failPayload)
        }
      } catch (fallbackErr) {
        console.error(
          JSON.stringify({
            event: 'security.gate.fallback_error',
            fileId,
            projectId,
            err: String(fallbackErr),
          }),
        )
      }
    }
  }
}
