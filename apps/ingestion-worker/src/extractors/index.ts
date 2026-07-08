/**
 * Extractor factory — returns the appropriate extractor for a given MIME type
 * and file name extension.
 */
import type { Extractor } from './types.js'
import { PdfExtractor } from './pdf.js'
import { DocxExtractor } from './docx.js'
import { CsvExtractor } from './csv.js'
import { TextExtractor } from './text.js'
import { XlsxExtractor } from './xlsx.js'
import { CodeExtractor } from './code.js'
import { PassthroughExtractor } from './passthrough.js'

export type { Extractor, ExtractionResult, ExtractionSection } from './types.js'

// File extension → extractor mapping (checked after MIME)
const EXT_MAP: Record<string, () => Extractor> = {
  ts: () => new CodeExtractor(),
  tsx: () => new CodeExtractor(),
  js: () => new CodeExtractor(),
  jsx: () => new CodeExtractor(),
  mjs: () => new CodeExtractor(),
  cjs: () => new CodeExtractor(),
  py: () => new CodeExtractor(),
  rb: () => new CodeExtractor(),
  rs: () => new CodeExtractor(),
  go: () => new CodeExtractor(),
  java: () => new CodeExtractor(),
  cs: () => new CodeExtractor(),
  cpp: () => new CodeExtractor(),
  c: () => new CodeExtractor(),
  h: () => new CodeExtractor(),
  php: () => new CodeExtractor(),
  swift: () => new CodeExtractor(),
  kt: () => new CodeExtractor(),
  sh: () => new CodeExtractor(),
  md: () => new TextExtractor(),
  txt: () => new TextExtractor(),
  csv: () => new CsvExtractor(),
  xlsx: () => new XlsxExtractor(),
  xls: () => new XlsxExtractor(),
  pdf: () => new PdfExtractor(),
  docx: () => new DocxExtractor(),
  doc: () => new DocxExtractor(),
}

/**
 * Create an extractor for the given MIME type and file name.
 *
 * Resolution order:
 *   1. MIME type exact match
 *   2. File extension match
 *   3. MIME type prefix match (text/*)
 *   4. Passthrough fallback
 */
export function createExtractor(declaredMime: string, fileName: string): Extractor {
  // 1. Exact MIME match
  const mimeExtractor = byMime(declaredMime)
  if (mimeExtractor) return mimeExtractor

  // 2. File extension
  const ext = fileName.split('.').pop()?.toLowerCase() ?? ''
  // eslint-disable-next-line security/detect-object-injection
  const extFactory = EXT_MAP[ext]
  if (extFactory) return extFactory()

  // 3. MIME prefix
  if (declaredMime.startsWith('text/')) return new TextExtractor()

  // 4. Fallback
  return new PassthroughExtractor()
}

function byMime(mime: string): Extractor | null {
  switch (mime) {
    case 'application/pdf':
      return new PdfExtractor()
    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
    case 'application/msword':
      return new DocxExtractor()
    case 'text/csv':
    case 'application/csv':
      return new CsvExtractor()
    case 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':
    case 'application/vnd.ms-excel':
      return new XlsxExtractor()
    case 'text/plain':
      return new TextExtractor()
    case 'text/markdown':
      return new TextExtractor()
    default:
      return null
  }
}
