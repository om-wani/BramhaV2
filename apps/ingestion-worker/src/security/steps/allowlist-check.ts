/**
 * MIME type allowlist for the ingestion worker.
 *
 * This mirrors the API-level allowlist (files.service.ts) and adds
 * image/svg+xml to enable the SVG disarm path. Defense-in-depth:
 * even if an attacker bypasses the API, unsupported types are rejected here.
 */
export const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // docx
  'text/markdown',
  'text/plain',
  'text/csv',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // xlsx
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/svg+xml', // worker-only; SVG disarmer strips unsafe content
  'audio/mpeg',
  'video/mp4',
  'application/zip',
])

/**
 * MIMEs where the disarmer does not transform the buffer.
 * These file types are trusted after the magic-byte + ClamAV checks.
 */
export const PASSTHROUGH_MIMES = new Set([
  'text/plain',
  'text/markdown',
  'audio/mpeg',
  'video/mp4',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
])

export interface AllowlistCheckResult {
  ok: boolean
  reason?: 'mime_not_allowed'
}

export function checkAllowlist(declaredMime: string): AllowlistCheckResult {
  if (ALLOWED_MIME_TYPES.has(declaredMime)) {
    return { ok: true }
  }
  return { ok: false, reason: 'mime_not_allowed' }
}
