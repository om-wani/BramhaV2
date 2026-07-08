/**
 * PDF extractor — uses pdf-parse to extract text per page.
 *
 * pdf-parse is a CommonJS module; use createRequire for ESM interop.
 */
import { createRequire } from 'node:module'
import type { ExtractionResult, Extractor } from './types.js'

const require = createRequire(import.meta.url)

interface PdfParseResult {
  text: string
  numpages: number
}

type PdfParseFn = (dataBuffer: Buffer) => Promise<PdfParseResult>

const pdfParse: PdfParseFn = require('pdf-parse') as PdfParseFn

export class PdfExtractor implements Extractor {
  async extract(buffer: Buffer): Promise<ExtractionResult> {
    const result = await pdfParse(buffer)
    const sections: ExtractionResult['sections'] = []
    const numpages = result.numpages

    if (numpages <= 1) {
      const text = result.text.trim()
      if (text) {
        sections.push({ headingTrail: ['Page 1'], text })
      }
    } else {
      // Split full text evenly across page count
      const lines = result.text.split('\n')
      const linesPerPage = Math.max(1, Math.ceil(lines.length / numpages))

      for (let page = 0; page < numpages; page++) {
        const start = page * linesPerPage
        const end = Math.min(start + linesPerPage, lines.length)
        const pageText = lines.slice(start, end).join('\n').trim()
        if (pageText) {
          sections.push({ headingTrail: [`Page ${page + 1}`], text: pageText })
        }
      }
    }

    const totalText = sections.map((s) => s.text).join('\n\n')
    return { sections, totalText }
  }
}
