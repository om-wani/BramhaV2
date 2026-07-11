/**
 * Probe report: types, generator, and file accumulator.
 *
 * Both rls-probes.test.ts and api-probes.test.ts call appendResults() in
 * afterAll to write their findings.  Each file owns a named section of the
 * report so that one file can run independently without clobbering the other.
 */

import fs from 'fs'
import path from 'path'

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface ProbeResult {
  probe: string
  table?: string
  route?: string
  passed: boolean
  failReason?: string
}

interface ReportFile {
  generatedAt: string
  [section: string]: unknown
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const REPORT_PATH = path.resolve(process.cwd(), 'test/tenant-probes/report.json')

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Serialise an array of probe results to a pretty-printed JSON string.
 * Useful for inline display or custom output.
 */
export function generateReport(results: ProbeResult[]): string {
  return JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      results,
    },
    null,
    2,
  )
}

/**
 * Merge `results` under `section` into the shared report file.
 * Reads the existing file (if any) so sections from other test files are preserved.
 */
export function appendResults(section: string, results: ProbeResult[]): void {
  let existing: ReportFile = { generatedAt: new Date().toISOString() }

  try {
    const raw = fs.readFileSync(REPORT_PATH, 'utf-8')
    const parsed = JSON.parse(raw) as ReportFile
    existing = { ...parsed }
  } catch {
    // File doesn't exist yet or is malformed — start fresh.
  }

  const summary = {
    total: results.length,
    passed: results.filter((r) => r.passed).length,
    failed: results.filter((r) => !r.passed).length,
  }

  existing.generatedAt = new Date().toISOString()
  existing[section] = { summary, probes: results }

  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true })
  fs.writeFileSync(REPORT_PATH, JSON.stringify(existing, null, 2))
}
