/**
 * XLSX extractor — uses SheetJS to extract each sheet as CSV-like text.
 */
import { read, utils } from 'xlsx'
import type { ExtractionResult, Extractor } from './types.js'

export class XlsxExtractor implements Extractor {
  async extract(buffer: Buffer): Promise<ExtractionResult> {
    const workbook = read(buffer, { type: 'buffer' })
    const sections: ExtractionResult['sections'] = []

    for (const sheetName of workbook.SheetNames) {
      // eslint-disable-next-line security/detect-object-injection
      const sheet = workbook.Sheets[sheetName]
      if (!sheet) continue
      const csv = utils.sheet_to_csv(sheet)
      const text = csv.trim()
      if (text) {
        sections.push({ headingTrail: [`Sheet: ${sheetName}`], text })
      }
    }

    const totalText = sections.map((s) => s.text).join('\n\n')
    return { sections, totalText }
  }
}
