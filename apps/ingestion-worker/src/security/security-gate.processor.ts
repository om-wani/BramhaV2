import type { Job } from 'bullmq'
import type { ScanStatus } from '@bramha/shared'
import { checkMagic } from './steps/magic-check.js'
import { checkSize } from './steps/size-check.js'
import { checkAllowlist, PASSTHROUGH_MIMES } from './steps/allowlist-check.js'
import { ClamAvDownError } from './errors.js'
import type { ClamAvResult } from './steps/clamav-scan.js'

// ── Types ────────────────────────────────────────────────────────────────────

export interface IngestFileJobData {
  fileId: string
  projectId: string
  userId: string
  storageKey: string
  declaredMime: string
  fileName: string
  sizeBytes: number
}

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

  /** Write disarmed buffer to clean bucket and remove from staging. */
  promoteFile: (
    cleanKey: string,
    buffer: Buffer,
    stagingKey: string,
    contentType: string,
  ) => Promise<void>

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
 *   1. Size check         → fail → UPDATE failed, emit failed, ack
 *   2. S3 download
 *   3. Magic-byte check   → fail → quarantine, UPDATE quarantined, emit, ack
 *   4. Allowlist check    → fail → quarantine, UPDATE quarantined, emit, ack
 *   5. ClamAV scan        → virus → quarantine, UPDATE, emit; DOWN → THROW (retry)
 *   6. Per-type disarm    → fail → quarantine, UPDATE quarantined, emit, ack
 *   7. Promote to clean   → PUT to clean bucket, DELETE from staging
 *   8. UPDATE clean, emit clean
 *
 * Any unexpected exception (except ClamAvDownError) is caught, the file is
 * quarantined (if downloaded) or failed, and the job is acked to prevent
 * infinite loops.
 */
export class SecurityGateProcessor {
  constructor(private readonly deps: SecurityGateDeps) {}

  async process(job: Job<IngestFileJobData>): Promise<void> {
    const { fileId, projectId, storageKey, declaredMime, fileName, sizeBytes } =
      job.data as IngestFileJobData

    const log = (event: string, extra?: Record<string, unknown>) =>
      console.log(JSON.stringify({ event, fileId, projectId, ...extra }))

    let fileBuffer: Buffer | undefined

    try {
      // ── Step 1: Size check (no S3 needed) ──────────────────────────────────
      const sizeResult = checkSize(sizeBytes, this.deps.maxFileBytes)
      if (!sizeResult.ok) {
        log('security.gate.size_fail', { sizeBytes })
        await this.deps.updateFileStatus(fileId, 'failed', { reason: 'file_too_large', sizeBytes })
        await this.deps.publisher.publish(failedChannel(projectId), {
          fileId,
          projectId,
          reason: 'file_too_large',
        })
        return
      }

      // ── Step 2: Download from staging ────────────────────────────────────
      log('security.gate.downloading')
      try {
        fileBuffer = await this.deps.downloadFile(storageKey)
      } catch (downloadErr) {
        log('security.gate.download_error', { err: String(downloadErr) })
        await this.deps.updateFileStatus(fileId, 'failed', { reason: 's3_download_error' })
        await this.deps.publisher.publish(failedChannel(projectId), {
          fileId,
          projectId,
          reason: 's3_download_error',
        })
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
        await this.deps.publisher.publish(quarantinedChannel(projectId), {
          fileId,
          projectId,
          reason: magicResult.reason ?? 'mime_mismatch',
        })
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
        await this.deps.publisher.publish(quarantinedChannel(projectId), {
          fileId,
          projectId,
          reason: 'mime_not_allowed',
        })
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
        await this.deps.publisher.publish(quarantinedChannel(projectId), {
          fileId,
          projectId,
          reason: 'virus_found',
          threatName: scanResult.threatName,
        })
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
        await this.deps.publisher.publish(quarantinedChannel(projectId), {
          fileId,
          projectId,
          reason: 'disarm_failed',
        })
        return
      }

      // ── Steps 7 & 8: Promote + mark clean ───────────────────────────────
      const cleanKey = `${projectId}/${fileId}/${fileName}`
      log('security.gate.promoting', { cleanKey })

      await this.deps.promoteFile(cleanKey, disarmedBuffer, storageKey, declaredMime)

      const wasDisarmed = !PASSTHROUGH_MIMES.has(declaredMime)
      const scanReport = { verdict: 'clean' as const, disarmed: wasDisarmed }

      await this.deps.updateFileStatus(fileId, 'clean', scanReport)
      await this.deps.publisher.publish(cleanChannel(projectId), {
        fileId,
        projectId,
        storageKey: `clean/${cleanKey}`,
        scanReport,
      })

      log('security.gate.clean', { disarmed: wasDisarmed })
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
          await this.deps.publisher.publish(quarantinedChannel(projectId), {
            fileId,
            projectId,
            reason: 'unexpected_error',
          })
        } else {
          await this.deps.updateFileStatus(fileId, 'failed', { reason: 'unexpected_error' })
          await this.deps.publisher.publish(failedChannel(projectId), {
            fileId,
            projectId,
            reason: 'unexpected_error',
          })
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
