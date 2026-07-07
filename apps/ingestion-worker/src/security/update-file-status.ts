import { sql } from '../db.js'
import type { ScanStatus } from '@bramha/shared'

/**
 * Updates the scan_status and scan_report columns for a file row.
 *
 * The worker connects with a BYPASSRLS role so no RLS setup is needed.
 * updated_at is refreshed on every call so downstream consumers can watch
 * for changes.
 */
export async function updateFileStatus(
  fileId: string,
  status: ScanStatus,
  report: Record<string, unknown>,
): Promise<void> {
  await sql`
    UPDATE files
    SET
      scan_status = ${status},
      scan_report = ${JSON.stringify(report)}::jsonb,
      updated_at  = NOW()
    WHERE id = ${fileId}
  `
}
