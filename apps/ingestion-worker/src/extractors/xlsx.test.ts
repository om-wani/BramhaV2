import { describe, it, expect } from 'vitest'
import ExcelJS from 'exceljs'
import { XlsxExtractor } from './xlsx.js'

async function makeXlsx(build: (wb: ExcelJS.Workbook) => void): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  build(wb)
  const buf = await wb.xlsx.writeBuffer()
  return Buffer.from(buf)
}

describe('XlsxExtractor', () => {
  it('extracts rows as CSV-like text, one section per non-empty sheet', async () => {
    const buffer = await makeXlsx((wb) => {
      const sheet = wb.addWorksheet('Sales')
      sheet.addRow(['Product', 'Revenue'])
      sheet.addRow(['Widget', 100])
    })

    const result = await new XlsxExtractor().extract(buffer)

    expect(result.sections).toHaveLength(1)
    expect(result.sections[0]!.headingTrail).toEqual(['Sheet: Sales'])
    expect(result.sections[0]!.text).toBe('Product,Revenue\nWidget,100')
    expect(result.totalText).toBe('Product,Revenue\nWidget,100')
  })

  it('skips empty sheets', async () => {
    const buffer = await makeXlsx((wb) => {
      wb.addWorksheet('Empty')
    })

    const result = await new XlsxExtractor().extract(buffer)

    expect(result.sections).toHaveLength(0)
    expect(result.totalText).toBe('')
  })

  it('quotes fields containing commas and escapes embedded quotes', async () => {
    const buffer = await makeXlsx((wb) => {
      const sheet = wb.addWorksheet('Notes')
      sheet.addRow(['has, a comma', 'has "quotes"'])
    })

    const result = await new XlsxExtractor().extract(buffer)

    expect(result.sections[0]!.text).toBe('"has, a comma","has ""quotes"""')
  })

  it('extracts multiple sheets as separate sections, joined with blank lines', async () => {
    const buffer = await makeXlsx((wb) => {
      wb.addWorksheet('First').addRow(['a'])
      wb.addWorksheet('Second').addRow(['b'])
    })

    const result = await new XlsxExtractor().extract(buffer)

    expect(result.sections).toHaveLength(2)
    expect(result.sections.map((s) => s.headingTrail[0])).toEqual(['Sheet: First', 'Sheet: Second'])
    expect(result.totalText).toBe('a\n\nb')
  })
})
