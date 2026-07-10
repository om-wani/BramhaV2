/**
 * Database MCP server — tool implementations.
 *
 * Security invariants:
 * - Every query runs in a BEGIN READ ONLY transaction (enforced at protocol level)
 * - Statement timeout enforced via SET LOCAL (5 seconds)
 * - Rows capped at 1000 (truncated flag set if exceeded)
 * - DB error messages NEVER returned to caller (may contain credentials/schema info)
 * - Raw DB URL NEVER appears in any response or log output
 */

// ── DB client interface (injectable for testing) ──────────────────────────────

/**
 * Minimal async query function interface.
 * The real implementation wraps postgres.js's sql.begin('READ ONLY', ...).
 * Tests inject a mock.
 */
export type DbQueryFn = (sql: string, params: unknown[]) => Promise<{ rows: unknown[] }>

// ── Result types ──────────────────────────────────────────────────────────────

export interface QuerySuccess {
  rows: unknown[]
  truncated?: true
}

export interface QueryFailure {
  error: 'query_failed'
}

export type QueryResult = QuerySuccess | QueryFailure

// ── Row cap ───────────────────────────────────────────────────────────────────

export const MAX_ROWS = 1000

// ── executeQuery ──────────────────────────────────────────────────────────────

/**
 * Execute a read-only parameterized query via the injected queryFn.
 *
 * The queryFn is responsible for wrapping the query in a READ ONLY transaction
 * with statement timeout. This separation makes the tool logic fully testable
 * without a real DB connection.
 *
 * On any error (read-only violation, timeout, syntax error, connection error):
 *   → returns { error: 'query_failed' } — NEVER the raw DB error message.
 */
export async function executeQuery(queryFn: DbQueryFn, sql: string, params: unknown[]): Promise<QueryResult> {
  try {
    const result = await queryFn(sql, params)
    const allRows = result.rows

    if (allRows.length > MAX_ROWS) {
      return {
        rows: allRows.slice(0, MAX_ROWS),
        truncated: true,
      }
    }

    return { rows: allRows }
  } catch {
    // CRITICAL: never echo back the error message — it may contain:
    // - Database credentials from the connection string
    // - Schema/table names that shouldn't be exposed
    // - Internal postgres error details
    return { error: 'query_failed' }
  }
}

// ── buildReadOnlyQueryFn (for server use, not exported to tests) ──────────────

/**
 * Builds a DbQueryFn that wraps queries in a postgres.js READ ONLY transaction
 * with a statement timeout.
 *
 * Import and usage is in index.ts to keep this module free of postgres deps
 * and fully testable in isolation.
 */
