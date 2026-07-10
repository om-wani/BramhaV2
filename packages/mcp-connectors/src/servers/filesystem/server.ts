/**
 * Filesystem MCP server — entrypoint.
 * Reads env vars, creates Fastify server, starts listening.
 */

import { createServer } from './index.js'

const jwtSecret = process.env['MCP_JWT_SECRET'] ?? ''
const fsRoot = process.env['MCP_FS_ROOT'] ?? '/data'
const port = parseInt(process.env['PORT'] ?? '4100', 10)

if (!jwtSecret) {
  console.error('[mcp-fs] MCP_JWT_SECRET is required')
  process.exit(1)
}

const app = createServer({ jwtSecret, fsRoot, port })

try {
  await app.listen({ port, host: '0.0.0.0' })
  console.log(`[mcp-fs] listening on port ${port}`)
} catch {
  // Log error without exposing config/credentials
  console.error('[mcp-fs] failed to start server')
  process.exit(1)
}
