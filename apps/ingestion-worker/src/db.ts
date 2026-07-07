/**
 * Postgres client for the ingestion worker.
 *
 * The worker runs as a trusted service process and connects with a BYPASSRLS
 * role (bramha_migrator / superuser) so it can update file scan status without
 * needing to set app.user_id session variables.
 *
 * The sql client is intentionally package-private — callers should use the
 * typed helpers in security/update-file-status.ts.
 */
import postgres from 'postgres'

if (!process.env['DATABASE_URL']) {
  throw new Error('DATABASE_URL environment variable is required')
}

export const sql = postgres(process.env['DATABASE_URL'])
