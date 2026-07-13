/**
 * XLSX extractor — extracts each sheet as CSV-like text.
 *
 * Uses exceljs, not the `xlsx` (SheetJS) package: the npm-published `xlsx`
 * line stopped receiving security patches after 0.18.5 (prototype pollution +
 * ReDoS advisories; fixes only ship from SheetJS's own CDN, not npm). This
 * extractor runs on untrusted user uploads post-ClamAV — malware scanning
 * doesn't stop a parser-level ReDoS or prototype pollution.
 */
import ExcelJS from 'exceljs'
import type { ExtractionResult, Extractor } from './types.js'

/** Minimal CSV field escaping: quote if it contains a comma, quote, or newline. */
function csvField(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replaceAll('"', '""')}"`
  }
  return value
}

function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'object') {
    if ('text' in value && typeof value.text === 'string') return value.text
    if ('result' in value) return String(value.result ?? '')
    if (value instanceof Date) return value.toISOString()
    return ''
  }
  return String(value)
}

export class XlsxExtractor implements Extractor {
  async extract(buffer: Buffer): Promise<ExtractionResult> {
    const workbook = new ExcelJS.Workbook()
    // exceljs's shipped types augment the global Buffer interface (a known
    // upstream wart: `declare interface Buffer extends ArrayBuffer {}`),
    // which makes its own .load() signature structurally disagree with
    // Node's real Buffer no matter how it's cast. eslint-disable + explicit
    // any at this one call boundary is the standard workaround.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await workbook.xlsx.load(buffer as any)
    const sections: ExtractionResult['sections'] = []

    for (const worksheet of workbook.worksheets) {
      const lines: string[] = []
      worksheet.eachRow((row) => {
        const cells = (row.values as ExcelJS.CellValue[]).slice(1) // index 0 is unused
        lines.push(cells.map((c) => csvField(cellText(c))).join(','))
      })
      const text = lines.join('\n').trim()
      if (text) {
        sections.push({ headingTrail: [`Sheet: ${worksheet.name}`], text })
      }
    }

    const totalText = sections.map((s) => s.text).join('\n\n')
    return { sections, totalText }
  }
}
