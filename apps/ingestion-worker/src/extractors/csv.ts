/**
 * CSV extractor — returns all rows as a single text section.
 * Capped at 50 000 characters to avoid overwhelming the chunker.
 */
import type { ExtractionResult, Extractor } from './types.js'

const MAX_CHARS = 50_000

export class CsvExtractor implements Extractor {
  async extract(buffer: Buffer): Promise<ExtractionResult> {
    let text = buffer.toString('utf8')

    if (text.length > MAX_CHARS) {
      text = text.slice(0, MAX_CHARS)
      // Trim to last complete line
      const lastNewline = text.lastIndexOf('\n')
      if (lastNewline > 0) text = text.slice(0, lastNewline)
    }

    const sections = text.trim()
      ? [{ headingTrail: ['CSV Data'], text: text.trim() }]
      : []

    const totalText = text.trim()
    return { sections, totalText }
  }
}
