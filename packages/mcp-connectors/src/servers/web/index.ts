/**
 * Web MCP server — Fastify app factory + manifest.
 *
 * POST /call  — verify Bearer token, execute tool, return { content: string }
 * GET  /health — return { ok: true }
 *
 * Security: only allowlisted hosts; RFC-1918/loopback blocked unconditionally.
 */

import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'
import { verifyJwtSignature } from '../../client/jwt-utils.js'
import { CapabilityTokenError } from '../../client/errors.js'
import type { ConnectorManifest } from '../../types.js'
import { webFetch, webSearch } from './tools.js'
import type { SearchConfig } from './tools.js'

// ── Manifest ──────────────────────────────────────────────────────────────────

export const WEB_MANIFEST: ConnectorManifest = {
  slug: 'mcp-web',
  name: 'Web',
  version: '1.0.0',
  transport: { type: 'streamable-http', endpoint: 'http://mcp-web:4103' },
  auth: { type: 'capability-token' },
  tools: [
    {
      name: 'fetch',
      scope: 'web:read',
      classification: 'read',
      inputSchema: {
        type: 'object',
        properties: {
          url: { type: 'string' },
          method: { type: 'string', enum: ['GET', 'POST'] },
          body: { type: 'string' },
        },
        required: ['url'],
      },
      limits: { maxResultBytes: 1048576, timeoutMs: 30000 },
    },
    {
      name: 'search',
      scope: 'web:read',
      classification: 'read',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          engine: { type: 'string', enum: ['brave', 'tavily'] },
        },
        required: ['query'],
      },
      limits: { maxResultBytes: 524288, timeoutMs: 30000 },
    },
  ],
  egress: ['api.search.brave.com', 'api.tavily.com'],
  dataClassification: 'public',
}

// ── Config ────────────────────────────────────────────────────────────────────

export interface WebServerConfig {
  jwtSecret: string
  /** Comma-separated hostname allowlist */
  allowlist: string[]
  port: number
  searchConfig: SearchConfig
}

// ── Server factory ────────────────────────────────────────────────────────────

export function createServer(config: WebServerConfig): FastifyInstance {
  const app = Fastify({ logger: false })

  // ── Health ──────────────────────────────────────────────────────────────────
  app.get('/health', async () => ({ ok: true }))

  // ── Tool call ───────────────────────────────────────────────────────────────
  app.post('/call', async (request, reply) => {
    // 1. Verify Bearer token
    const auth = (request.headers as Record<string, string | undefined>)['authorization']
    if (!auth?.startsWith('Bearer ')) {
      return reply.status(401).send({ error: 'unauthorized' })
    }
    const token = auth.slice(7)

    try {
      verifyJwtSignature<Record<string, unknown>>(token, config.jwtSecret)
    } catch (err) {
      if (err instanceof CapabilityTokenError) {
        return reply.status(401).send({ error: 'unauthorized' })
      }
      return reply.status(401).send({ error: 'unauthorized' })
    }

    // 2. Parse body
    const body = request.body as { tool?: string; args?: Record<string, unknown> }
    const tool = body.tool
    const args = body.args ?? {}

    if (!tool) return reply.status(400).send({ error: 'missing_tool' })

    // 3. Dispatch
    switch (tool) {
      case 'fetch': {
        const url = args['url']
        const method = args['method'] === 'POST' ? ('POST' as const) : ('GET' as const)
        const fetchBody = typeof args['body'] === 'string' ? args['body'] : undefined

        if (typeof url !== 'string') {
          return reply.status(400).send({ error: 'invalid_args' })
        }

        const result = await webFetch(url, method, fetchBody, config.allowlist)

        if (result.error === 'host_not_allowed' || result.error === 'invalid_url') {
          return reply.status(400).send({ error: result.error })
        }
        if (result.error) {
          return reply.status(500).send({ error: result.error })
        }

        return reply.send({ content: result.content })
      }

      case 'search': {
        const query = args['query']
        const engine = args['engine'] === 'tavily' ? ('tavily' as const) : ('brave' as const)

        if (typeof query !== 'string') {
          return reply.status(400).send({ error: 'invalid_args' })
        }

        // Extend allowlist with search API hosts for this call
        const searchAllowlist = [
          ...config.allowlist,
          'api.search.brave.com',
          'api.tavily.com',
        ]

        const result = await webSearch(query, engine, config.searchConfig, searchAllowlist)

        if (result.error === 'search_not_configured') {
          return reply.status(400).send({ error: 'search_not_configured' })
        }
        if (result.error) {
          return reply.status(500).send({ error: result.error })
        }

        return reply.send({ content: result.content })
      }

      default:
        return reply.status(400).send({ error: 'unknown_tool' })
    }
  })

  return app
}
