/**
 * Git MCP server — Fastify app factory + manifest.
 *
 * POST /call  — verify Bearer token, execute tool, return { content: string }
 * GET  /health — return { ok: true }
 *
 * Security: only https/git+https repos; no push; file paths chroot-checked.
 */

import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'
import { verifyJwtSignature } from '../../client/jwt-utils.js'
import type { CapabilityTokenPayload, ConnectorManifest } from '../../types.js'
import { gitClone, gitReadFile } from './tools.js'

// ── Manifest ──────────────────────────────────────────────────────────────────

export const GIT_MANIFEST: ConnectorManifest = {
  slug: 'mcp-git',
  name: 'Git',
  version: '1.0.0',
  transport: { type: 'streamable-http', endpoint: 'http://mcp-git:4102' },
  auth: { type: 'capability-token' },
  tools: [
    {
      name: 'clone',
      scope: 'git:read',
      classification: 'read',
      inputSchema: {
        type: 'object',
        properties: {
          repoUrl: { type: 'string' },
          ref: { type: 'string' },
        },
        required: ['repoUrl'],
      },
      limits: { maxResultBytes: 4096, timeoutMs: 120000 },
    },
    {
      name: 'read_file',
      scope: 'git:read',
      classification: 'read',
      inputSchema: {
        type: 'object',
        properties: {
          repoUrl: { type: 'string' },
          filePath: { type: 'string' },
          ref: { type: 'string' },
        },
        required: ['repoUrl', 'filePath'],
      },
      limits: { maxResultBytes: 65536, timeoutMs: 120000 },
    },
  ],
  egress: ['github.com', 'gitlab.com', 'bitbucket.org'],
  dataClassification: 'tenant-confidential',
}

// ── Config ────────────────────────────────────────────────────────────────────

export interface GitServerConfig {
  jwtSecret: string
  gitRoot: string
  port: number
}

// ── Server factory ────────────────────────────────────────────────────────────

export function createServer(config: GitServerConfig): FastifyInstance {
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

    let payload: CapabilityTokenPayload
    try {
      const raw = verifyJwtSignature<Record<string, unknown>>(token, config.jwtSecret)
      payload = raw as unknown as CapabilityTokenPayload
    } catch {
      return reply.status(401).send({ error: 'unauthorized' })
    }

    // 2. Parse body
    const body = request.body as { tool?: string; args?: Record<string, unknown> }
    const tool = body.tool
    const args = body.args ?? {}

    if (!tool) return reply.status(400).send({ error: 'missing_tool' })

    // 3. Scope check — all git tools require git:read
    const GIT_TOOL_SCOPES: Record<string, string> = { clone: 'git:read', read_file: 'git:read' }
    // eslint-disable-next-line security/detect-object-injection
    const gitRequiredScope = GIT_TOOL_SCOPES[tool]
    if (!gitRequiredScope) return reply.status(400).send({ error: 'unknown_tool' })
    if (payload.scope !== gitRequiredScope) return reply.status(403).send({ error: 'scope_mismatch' })

    // 4. Dispatch
    switch (tool) {
      case 'clone': {
        const repoUrl = args['repoUrl']
        const ref = typeof args['ref'] === 'string' ? args['ref'] : undefined

        if (typeof repoUrl !== 'string') {
          return reply.status(400).send({ error: 'invalid_args' })
        }

        const result = await gitClone(config.gitRoot, payload.projectId, repoUrl, ref)

        if (result.error === 'scheme_not_allowed') {
          return reply.status(400).send({ error: 'scheme_not_allowed' })
        }
        if (result.error) {
          return reply.status(500).send({ error: result.error })
        }

        return reply.send({ content: JSON.stringify({ path: result.path }) })
      }

      case 'read_file': {
        const repoUrl = args['repoUrl']
        const filePath = args['filePath']
        const ref = typeof args['ref'] === 'string' ? args['ref'] : undefined

        if (typeof repoUrl !== 'string' || typeof filePath !== 'string') {
          return reply.status(400).send({ error: 'invalid_args' })
        }

        const result = await gitReadFile(config.gitRoot, payload.projectId, repoUrl, filePath, ref)

        if (result.error === 'scheme_not_allowed' || result.error === 'path_traversal_denied') {
          return reply.status(400).send({ error: result.error })
        }
        if (result.error) {
          return reply.status(500).send({ error: result.error })
        }

        return reply.send({ content: result.content })
      }

      default:
        // Unreachable: scope check above catches unknown tools
        return reply.status(400).send({ error: 'unknown_tool' })
    }
  })

  return app
}
