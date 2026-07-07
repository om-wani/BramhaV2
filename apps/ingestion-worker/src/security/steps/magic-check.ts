import { fileTypeFromBuffer } from 'file-type'

/**
 * MIMEs that are text-based or lack a binary magic-byte signature.
 * We cannot sniff these with file-type, so we skip the magic check for them.
 * The allowlist check (step 4) still applies.
 */
const TEXT_AND_NOMAGIC_MIMES = new Set([
  'text/plain',
  'text/markdown',
  'text/csv',
  'image/svg+xml', // XML-based, no magic bytes
  // OOXML (Office Open XML) formats are zip-based; some file-type versions
  // return application/zip for these. Accept either.
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
])

/**
 * MIME types for which the *class* (top-level type) is sufficient for matching,
 * rather than requiring an exact MIME string.
 * e.g. declared=image/jpeg + detected=image/png → same class → OK
 */
const CLASS_MATCH_TYPES = new Set(['image', 'video', 'audio'])

/**
 * Additional MIME pairs that are considered equivalent because different
 * versions of file-type may return either value for the same format.
 */
const EQUIVALENT_PAIRS: Array<[string, string]> = [
  [
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/zip',
  ],
  [
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/zip',
  ],
]

function isEquivalent(a: string, b: string): boolean {
  for (const [x, y] of EQUIVALENT_PAIRS) {
    if ((a === x && b === y) || (a === y && b === x)) return true
  }
  return false
}

function mimeClassMatches(declared: string, detected: string): boolean {
  if (declared === detected) return true
  if (isEquivalent(declared, detected)) return true

  const declaredType = declared.split('/')[0]
  const detectedType = detected.split('/')[0]

  if (CLASS_MATCH_TYPES.has(declaredType ?? '')) {
    return declaredType === detectedType
  }

  // For application/* and text/*: require exact match
  return false
}

export interface MagicCheckResult {
  ok: boolean
  detectedMime?: string
  reason?: 'mime_mismatch' | 'undetectable'
}

/**
 * Sniffs the actual file type from magic bytes and compares it against the
 * declared MIME type.
 *
 * For text-based formats (CSV, Markdown, plain text, SVG) there are no
 * reliable magic bytes, so the check is skipped and ok=true is returned.
 */
export async function checkMagic(
  buffer: Buffer,
  declaredMime: string,
): Promise<MagicCheckResult> {
  // Skip magic check for formats without binary signatures
  if (TEXT_AND_NOMAGIC_MIMES.has(declaredMime)) {
    return { ok: true }
  }

  const result = await fileTypeFromBuffer(new Uint8Array(buffer))

  if (!result) {
    // Binary format declared but no magic bytes detected → reject
    return { ok: false, reason: 'undetectable' }
  }

  const matches = mimeClassMatches(declaredMime, result.mime)
  if (matches) {
    return { ok: true, detectedMime: result.mime }
  }
  return { ok: false, detectedMime: result.mime, reason: 'mime_mismatch' }
}
