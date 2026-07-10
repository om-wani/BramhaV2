/**
 * Database MCP server — entrypoint.
 * Reads env vars, creates Fastify server, starts listening.
 *
 * SECURITY: MCP_DB_URL is read here and passed to createServer().
 * It is stored only in the postgres client closure — never logged or returned.
 */

import { createServer } from './index.js'

const jwtSecret = process.env['MCP_JWT_SECRET'] ?? ''
// DB URL contains credentials — handled carefully:
// - never logged
// - never returned in error responses
// - stored only inside the postgres.js client closure
const dbUrl = process.env['MCP_DB_URL'] ?? ''
const port = parseInt(process.env['PORT'] ?? '4101', 10)

if (!jwtSecret) {
  console.error('[mcp-db] MCP_JWT_SECRET is required')
  process.exit(1)
}

if (!dbUrl) {
  console.error('[mcp-db] MCP_DB_URL is required')
  process.exit(1)
}

const app = createServer({ jwtSecret, dbUrl, port })

try {
  await app.listen({ port, host: '0.0.0.0' })
  console.log(`[mcp-db] listening on port ${port}`)
} catch {
  // Never log the error — it may contain the DB URL from the stack trace
  console.error('[mcp-db] failed to start server')
  process.exit(1)
}
