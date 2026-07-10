/**
 * Database MCP server — Fastify app factory + manifest.
 *
 * POST /call  — verify Bearer token, execute tool, return { content: string }
 * GET  /health — return { ok: true }
 *
 * All queries run in BEGIN READ ONLY transactions with a 5-second statement timeout.
 * DB credentials NEVER appear in responses or logs.
 */

import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'
import postgres from 'postgres'
import { verifyJwtSignature } from '../../client/jwt-utils.js'
import { CapabilityTokenError } from '../../client/errors.js'
import type { ConnectorManifest } from '../../types.js'
import { executeQuery } from './tools.js'
import type { DbQueryFn } from './tools.js'

// ── Manifest ──────────────────────────────────────────────────────────────────

export const DB_MANIFEST: ConnectorManifest = {
  slug: 'mcp-db',
  name: 'Database',
  version: '1.0.0',
  transport: { type: 'streamable-http', endpoint: 'http://mcp-db:4101' },
  auth: { type: 'capability-token' },
  tools: [
    {
      name: 'query',
      scope: 'db:read',
      classification: 'read',
      inputSchema: {
        type: 'object',
        properties: {
          sql: { type: 'string' },
          params: { type: 'array', items: {} },
        },
        required: ['sql'],
      },
      limits: { maxResultBytes: 524288, timeoutMs: 10000 },
    },
  ],
  egress: [],
  dataClassification: 'tenant-confidential',
}

// ── Config ────────────────────────────────────────────────────────────────────

export interface DbServerConfig {
  jwtSecret: string
  /** postgres.js connection string — NEVER echoed in responses */
  dbUrl: string
  port: number
}

// ── Server factory ────────────────────────────────────────────────────────────

export function createServer(config: DbServerConfig): FastifyInstance {
  // Create postgres client — credentials stay in this closure, never in request handlers
  const sql = postgres(config.dbUrl, {
    max: 5,
    idle_timeout: 30,
    // Disable all postgres.js logging to prevent credential leaks
    debug: false,
  })

  /**
   * Query function: wraps user query in a READ ONLY transaction with statement timeout.
   * postgres.js's sql.unsafe() sends a parameterized query to postgres (safe, not string-interpolated).
   */
  const queryFn: DbQueryFn = async (userSql, params) => {
    const rows = await sql.begin('READ ONLY', async (tx) => {
      // Statement timeout applies only within this transaction
      await tx`SET LOCAL statement_timeout = '5000'`
      // sql.unsafe sends parameterized query — user SQL is NOT string-interpolated
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await tx.unsafe(userSql, params as any[])
      return Array.from(result)
    })
    return { rows }
  }

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
      case 'query': {
        const userSql = args['sql']
        const params = Array.isArray(args['params']) ? args['params'] : []

        if (typeof userSql !== 'string' || userSql.trim() === '') {
          return reply.status(400).send({ error: 'invalid_args' })
        }

        const result = await executeQuery(queryFn, userSql, params)

        if ('error' in result) {
          // query_failed — do NOT include any DB details
          return reply.status(500).send({ error: 'query_failed' })
        }

        return reply.send({ content: JSON.stringify(result) })
      }

      default:
        return reply.status(400).send({ error: 'unknown_tool' })
    }
  })

  // Cleanup postgres connection on server close
  app.addHook('onClose', async () => {
    await sql.end()
  })

  return app
}
