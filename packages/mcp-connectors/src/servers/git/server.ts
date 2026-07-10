/**
 * Git MCP server — entrypoint.
 */

import { createServer } from './index.js'

const jwtSecret = process.env['MCP_JWT_SECRET'] ?? ''
const gitRoot = process.env['MCP_GIT_ROOT'] ?? '/tmp/mcp-git'
const port = parseInt(process.env['PORT'] ?? '4102', 10)

if (!jwtSecret) {
  console.error('[mcp-git] MCP_JWT_SECRET is required')
  process.exit(1)
}

const app = createServer({ jwtSecret, gitRoot, port })

try {
  await app.listen({ port, host: '0.0.0.0' })
  console.log(`[mcp-git] listening on port ${port}`)
} catch {
  console.error('[mcp-git] failed to start server')
  process.exit(1)
}
