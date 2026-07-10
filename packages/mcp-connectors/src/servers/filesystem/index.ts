/**
 * Filesystem MCP server — Fastify app factory + manifest.
 *
 * POST /call  — verify Bearer token, execute tool, return { content: string }
 * GET  /health — return { ok: true }
 */

import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'
import { verifyJwtSignature } from '../../client/jwt-utils.js'
import { CapabilityTokenError } from '../../client/errors.js'
import type { CapabilityTokenPayload, ConnectorManifest } from '../../types.js'
import { fsReadFile, fsListDir, fsWriteFile } from './tools.js'

// ── Manifest ──────────────────────────────────────────────────────────────────

export const FS_MANIFEST: ConnectorManifest = {
  slug: 'mcp-fs',
  name: 'Filesystem',
  version: '1.0.0',
  transport: { type: 'streamable-http', endpoint: 'http://mcp-fs:4100' },
  auth: { type: 'capability-token' },
  tools: [
    {
      name: 'read_file',
      scope: 'fs:read',
      classification: 'read',
      inputSchema: {
        type: 'object',
        properties: { path: { type: 'string' } },
        required: ['path'],
      },
      limits: { maxResultBytes: 65536, timeoutMs: 5000 },
    },
    {
      name: 'list_dir',
      scope: 'fs:read',
      classification: 'read',
      inputSchema: {
        type: 'object',
        properties: { path: { type: 'string' } },
        required: ['path'],
      },
      limits: { maxResultBytes: 65536, timeoutMs: 5000 },
    },
    {
      name: 'write_file',
      scope: 'fs:write',
      classification: 'write',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          content: { type: 'string' },
        },
        required: ['path', 'content'],
      },
      limits: { maxResultBytes: 1024, timeoutMs: 5000 },
    },
  ],
  egress: [],
  dataClassification: 'tenant-confidential',
}

// ── Config ────────────────────────────────────────────────────────────────────

export interface FsServerConfig {
  jwtSecret: string
  /** Base directory; project root = fsRoot/<projectId> */
  fsRoot: string
  port: number
}

// ── Server factory ────────────────────────────────────────────────────────────

export function createServer(config: FsServerConfig): FastifyInstance {
  const app = Fastify({
    // Disable default logger to prevent accidental credential leaks via request logging
    logger: false,
  })

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

    if (!tool) {
      return reply.status(400).send({ error: 'missing_tool' })
    }

    // 3. Project root = fsRoot/<projectId>
    const projectRoot = `${config.fsRoot}/${payload.projectId}`

    // 4. Dispatch tool
    try {
      switch (tool) {
        case 'read_file': {
          const path = args['path']
          if (typeof path !== 'string') {
            return reply.status(400).send({ error: 'invalid_args' })
          }
          const result = await fsReadFile(projectRoot, path)
          if (result.error === 'path_traversal_denied') {
            return reply.status(400).send({ error: result.error })
          }
          if (result.error) {
            return reply.status(500).send({ error: result.error })
          }
          return reply.send({ content: result.content })
        }

        case 'list_dir': {
          const path = args['path'] ?? '.'
          if (typeof path !== 'string') {
            return reply.status(400).send({ error: 'invalid_args' })
          }
          const result = await fsListDir(projectRoot, path)
          if (result.error === 'path_traversal_denied') {
            return reply.status(400).send({ error: result.error })
          }
          if (result.error) {
            return reply.status(500).send({ error: result.error })
          }
          return reply.send({ content: JSON.stringify(result.entries) })
        }

        case 'write_file': {
          const path = args['path']
          const content = args['content']
          if (typeof path !== 'string' || typeof content !== 'string') {
            return reply.status(400).send({ error: 'invalid_args' })
          }
          const result = await fsWriteFile(projectRoot, path, content)
          if (result.error === 'path_traversal_denied') {
            return reply.status(400).send({ error: result.error })
          }
          if (result.error) {
            return reply.status(500).send({ error: result.error })
          }
          return reply.send({ content: 'ok' })
        }

        default:
          return reply.status(400).send({ error: 'unknown_tool' })
      }
    } catch {
      // Never leak internal errors
      return reply.status(500).send({ error: 'internal_error' })
    }
  })

  return app
}
