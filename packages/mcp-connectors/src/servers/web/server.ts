/**
 * Web MCP server — entrypoint.
 */

import { createServer } from './index.js'

const jwtSecret = process.env['MCP_JWT_SECRET'] ?? ''
const allowlistEnv = process.env['MCP_WEB_ALLOWLIST'] ?? 'api.github.com,docs.anthropic.com'
const port = parseInt(process.env['PORT'] ?? '4103', 10)

if (!jwtSecret) {
  console.error('[mcp-web] MCP_JWT_SECRET is required')
  process.exit(1)
}

const allowlist = allowlistEnv
  .split(',')
  .map((h) => h.trim())
  .filter(Boolean)

const app = createServer({
  jwtSecret,
  allowlist,
  port,
  searchConfig: {
    ...(process.env['MCP_BRAVE_API_KEY'] !== undefined
      ? { braveApiKey: process.env['MCP_BRAVE_API_KEY'] }
      : {}),
    ...(process.env['MCP_TAVILY_API_KEY'] !== undefined
      ? { tavilyApiKey: process.env['MCP_TAVILY_API_KEY'] }
      : {}),
  },
})

try {
  await app.listen({ port, host: '0.0.0.0' })
  console.log(`[mcp-web] listening on port ${port}`)
} catch {
  console.error('[mcp-web] failed to start server')
  process.exit(1)
}
