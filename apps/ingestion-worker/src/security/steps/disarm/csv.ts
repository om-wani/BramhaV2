/**
 * Strips formula injection from CSV files.
 *
 * Cells that start with '=', '+', '-', or '@' can be interpreted as formulas
 * by spreadsheet applications (Excel, Google Sheets, LibreOffice). We neutralise
 * them by prepending a single quote character, which most spreadsheets treat as
 * a plain-text prefix.
 *
 * Handles both quoted and unquoted cells. Does not attempt full RFC 4180
 * parsing (embedded newlines in quoted fields etc.) — the goal is formula
 * injection prevention, not round-trip fidelity.
 */

const DANGEROUS_PREFIXES = new Set(['=', '+', '-', '@'])

function sanitizeCell(cell: string): string {
  if (!cell) return cell

  const isQuoted = cell.startsWith('"') && cell.endsWith('"') && cell.length >= 2

  if (isQuoted) {
    const inner = cell.slice(1, -1)
    if (inner.length > 0 && DANGEROUS_PREFIXES.has(inner[0]!)) {
      return `"'${inner}"`
    }
    return cell
  }

  if (DANGEROUS_PREFIXES.has(cell[0]!)) {
    return `'${cell}`
  }

  return cell
}

/**
 * Parses a CSV line into cells, respecting quoted fields.
 * Handles commas inside quoted fields but not escaped quotes for simplicity.
 */
function splitCsvLine(line: string): string[] {
  const cells: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    // eslint-disable-next-line security/detect-object-injection
    const ch = line[i]!
    if (ch === '"') {
      inQuotes = !inQuotes
      current += ch
    } else if (ch === ',' && !inQuotes) {
      cells.push(current)
      current = ''
    } else {
      current += ch
    }
  }
  cells.push(current)
  return cells
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function disarmCsv(buffer: Buffer, _mime?: string): Promise<Buffer> {
  const input = buffer.toString('utf-8')

  // Normalize line endings before splitting so CRLF files are handled correctly
  const normalized = input.replace(/\r\n/g, '\n').replace(/\r/g, '\n')

  const sanitized = normalized
    .split('\n')
    .map((line) => {
      const cells = splitCsvLine(line)
      return cells.map(sanitizeCell).join(',')
    })
    .join('\n')

  return Buffer.from(sanitized, 'utf-8')
}
