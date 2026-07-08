/**
 * Passthrough extractor — for unsupported file types.
 * Returns the entire buffer as UTF-8 text in a single section.
 */
import type { ExtractionResult, Extractor } from './types.js'

export class PassthroughExtractor implements Extractor {
  async extract(buffer: Buffer): Promise<ExtractionResult> {
    const text = buffer.toString('utf8').trim()
    if (!text) return { sections: [], totalText: '' }

    const sections = [{ headingTrail: ['Content'], text }]
    return { sections, totalText: text }
  }
}
