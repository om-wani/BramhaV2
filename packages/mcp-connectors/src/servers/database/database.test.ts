/**
 * Database MCP server — security invariant tests.
 *
 * Tests cover:
 * - INSERT attempt in a read-only tx → query_failed (not the raw DB error)
 * - SELECT succeeds and returns rows
 * - > 1000 rows → truncated flag set
 * - Statement timeout → query_failed (not the raw DB error)
 * - No credential leakage: raw error messages never reach caller
 */

import { describe, it, expect } from 'vitest'
import { executeQuery, MAX_ROWS } from './tools.js'
import type { DbQueryFn } from './tools.js'

// ── Fixtures ──────────────────────────────────────────────────────────────────

/** Mock that simulates a read-only transaction error (what postgres throws for DML). */
const readOnlyErrFn: DbQueryFn = async () => {
  throw new Error('ERROR: cannot execute INSERT in a read-only transaction')
}

/** Mock that simulates a statement timeout. */
const timeoutErrFn: DbQueryFn = async () => {
  throw new Error('ERROR: canceling statement due to statement timeout')
}

/** Mock that returns the given rows. */
function makeSelectFn(rows: unknown[]): DbQueryFn {
  return async () => ({ rows })
}

// ── Read-only enforcement ─────────────────────────────────────────────────────

describe('executeQuery — read-only transaction', () => {
  it('returns { error: "query_failed" } when DB throws read-only transaction error', async () => {
    const result = await executeQuery(readOnlyErrFn, 'INSERT INTO foo VALUES (1)', [])
    expect(result).toEqual({ error: 'query_failed' })
  })

  it('does NOT leak the raw DB error message in the response', async () => {
    const result = await executeQuery(readOnlyErrFn, 'INSERT INTO foo VALUES (1)', [])
    const serialized = JSON.stringify(result)
    expect(serialized).not.toContain('cannot execute INSERT')
    expect(serialized).not.toContain('read-only transaction')
  })

  it('does NOT leak password/credential info in query_failed response', async () => {
    const credFn: DbQueryFn = async () => {
      throw new Error('FATAL: password authentication failed for user "bramha_readonly" at host "postgres"')
    }
    const result = await executeQuery(credFn, 'SELECT 1', [])
    const serialized = JSON.stringify(result)
    expect(serialized).not.toContain('password authentication failed')
    expect(serialized).not.toContain('bramha_readonly')
  })
})

// ── Statement timeout ─────────────────────────────────────────────────────────

describe('executeQuery — statement timeout', () => {
  it('returns { error: "query_failed" } when DB throws statement timeout', async () => {
    const result = await executeQuery(timeoutErrFn, 'SELECT pg_sleep(10)', [])
    expect(result).toEqual({ error: 'query_failed' })
  })

  it('does NOT leak statement timeout message', async () => {
    const result = await executeQuery(timeoutErrFn, 'SELECT pg_sleep(10)', [])
    const serialized = JSON.stringify(result)
    expect(serialized).not.toContain('statement timeout')
    expect(serialized).not.toContain('canceling statement')
  })
})

// ── Successful SELECT ─────────────────────────────────────────────────────────

describe('executeQuery — successful SELECT', () => {
  it('returns rows for a successful query', async () => {
    const mockRows = [{ id: 1, name: 'Alice' }, { id: 2, name: 'Bob' }]
    const result = await executeQuery(makeSelectFn(mockRows), 'SELECT id, name FROM users', [])
    expect(result).toEqual({ rows: mockRows })
  })

  it('passes params through to the queryFn', async () => {
    const captured: { sql: string; params: unknown[] }[] = []
    const captureFn: DbQueryFn = async (sql, params) => {
      captured.push({ sql, params })
      return { rows: [] }
    }
    await executeQuery(captureFn, 'SELECT * FROM users WHERE id = $1', [42])
    expect(captured).toHaveLength(1)
    expect(captured[0]?.sql).toBe('SELECT * FROM users WHERE id = $1')
    expect(captured[0]?.params).toEqual([42])
  })

  it('returns rows with no truncated flag when count ≤ 1000', async () => {
    const rows = Array.from({ length: 100 }, (_, i) => ({ id: i }))
    const result = await executeQuery(makeSelectFn(rows), 'SELECT * FROM t', [])
    if ('error' in result) throw new Error('expected success')
    expect(result.rows).toHaveLength(100)
    expect(result.truncated).toBeUndefined()
  })
})

// ── Row cap / truncation ──────────────────────────────────────────────────────

describe('executeQuery — row cap', () => {
  it('truncates result to 1000 rows and sets truncated=true when rows > 1000', async () => {
    const rows = Array.from({ length: MAX_ROWS + 50 }, (_, i) => ({ id: i }))
    const result = await executeQuery(makeSelectFn(rows), 'SELECT * FROM big_table', [])
    if ('error' in result) throw new Error('expected success')
    expect(result.rows).toHaveLength(MAX_ROWS)
    expect(result.truncated).toBe(true)
  })

  it('returns exactly 1000 rows (boundary) without truncated flag', async () => {
    const rows = Array.from({ length: MAX_ROWS }, (_, i) => ({ id: i }))
    const result = await executeQuery(makeSelectFn(rows), 'SELECT * FROM t', [])
    if ('error' in result) throw new Error('expected success')
    expect(result.rows).toHaveLength(MAX_ROWS)
    expect(result.truncated).toBeUndefined()
  })
})

// ── Bearer token verification ─────────────────────────────────────────────────

describe('createServer bearer verification', () => {
  it('returns 401 when Authorization header is missing', async () => {
    const { createServer } = await import('./index.js')
    // Use a dummy DB URL — no actual connection is made in this test
    const app = createServer({
      jwtSecret: 'test-secret',
      dbUrl: 'postgresql://dummy:dummy@localhost:5432/dummy',
      port: 4101,
    })

    const response = await app.inject({
      method: 'POST',
      url: '/call',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tool: 'query', args: { sql: 'SELECT 1' } }),
    })

    expect(response.statusCode).toBe(401)
  })

  it('returns 200 on /health without auth', async () => {
    const { createServer } = await import('./index.js')
    const app = createServer({
      jwtSecret: 'test-secret',
      dbUrl: 'postgresql://dummy:dummy@localhost:5432/dummy',
      port: 4101,
    })

    const response = await app.inject({ method: 'GET', url: '/health' })
    expect(response.statusCode).toBe(200)
  })
})

// ── Credential grep assertion ─────────────────────────────────────────────────

describe('no raw credentials in source', () => {
  it('tools.ts does not return or reference process.env.MCP_DB_URL in error paths', async () => {
    // Read the tools source to verify credentials are never embedded in error responses
    const { readFileSync } = await import('node:fs')
    const toolsPath = new URL('./tools.ts', import.meta.url).pathname
    const src = readFileSync(toolsPath, 'utf-8')

    // The tools file must not reference MCP_DB_URL (credentials belong only in server.ts)
    expect(src).not.toContain('MCP_DB_URL')
    expect(src).not.toContain('process.env')

    // Error return must only use the safe sentinel string
    expect(src).toContain("'query_failed'")
  })
})
