/** Default max file size for the worker (100 MB). The API enforces 50 MB;
 *  this is a defense-in-depth guard for out-of-band uploads. */
export const DEFAULT_MAX_FILE_BYTES = 100 * 1024 * 1024

/**
 * Reads MAX_FILE_BYTES from the environment (defaults to 100 MB).
 * Parsed once at module load so repeated calls are O(1).
 */
export const MAX_FILE_BYTES: number = (() => {
  const raw = process.env['MAX_FILE_BYTES']
  if (!raw) return DEFAULT_MAX_FILE_BYTES
  const parsed = parseInt(raw, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_FILE_BYTES
})()

export interface SizeCheckResult {
  ok: boolean
  reason?: 'file_too_large'
}

export function checkSize(sizeBytes: number, maxBytes = MAX_FILE_BYTES): SizeCheckResult {
  if (sizeBytes > maxBytes) {
    return { ok: false, reason: 'file_too_large' }
  }
  return { ok: true }
}
