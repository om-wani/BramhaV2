/**
 * Filesystem MCP server — security invariant tests.
 *
 * Tests cover the path traversal corpus required by the spec:
 * - ../etc/passwd              → path_traversal_denied
 * - absolute path outside root → path_traversal_denied
 * - null byte                  → path_traversal_denied
 * - valid relative path        → resolves correctly (calls through)
 */

import { describe, it, expect } from 'vitest'
import { resolveSafePath, PathTraversalError, fsReadFile, fsListDir } from './tools.js'

const PROJECT_ROOT = '/data/proj-abc123'

// ── resolveSafePath unit tests ─────────────────────────────────────────────────

describe('resolveSafePath', () => {
  it('denies "../etc/passwd" (directory traversal)', async () => {
    await expect(resolveSafePath(PROJECT_ROOT, '../etc/passwd')).rejects.toThrow(
      PathTraversalError,
    )
  })

  it('denies absolute path to another project ("/data/other-project/secret.txt")', async () => {
    await expect(
      resolveSafePath(PROJECT_ROOT, '/data/other-project/secret.txt'),
    ).rejects.toThrow(PathTraversalError)
  })

  it('denies path with null byte ("file\\0etc")', async () => {
    await expect(resolveSafePath(PROJECT_ROOT, 'file\0etc')).rejects.toThrow(
      PathTraversalError,
    )
  })

  it('denies nested traversal ("a/../../etc/passwd")', async () => {
    await expect(resolveSafePath(PROJECT_ROOT, 'a/../../etc/passwd')).rejects.toThrow(
      PathTraversalError,
    )
  })

  it('denies Windows-style traversal ("a\\..\\..\\etc\\passwd")', async () => {
    await expect(resolveSafePath(PROJECT_ROOT, 'a\\..\\..\\etc\\passwd')).rejects.toThrow(
      PathTraversalError,
    )
  })

  it('accepts a valid relative path ("files/doc.txt")', async () => {
    // The path does not exist on disk — realpath will throw ENOENT which is OK for write
    const result = await resolveSafePath(PROJECT_ROOT, 'files/doc.txt')
    expect(result).toBe(`${PROJECT_ROOT}/files/doc.txt`)
  })

  it('accepts the project root itself ("")', async () => {
    const result = await resolveSafePath(PROJECT_ROOT, '')
    expect(result).toBe(PROJECT_ROOT)
  })

  it('accepts a path with a dot segment ("./subdir/file.txt")', async () => {
    const result = await resolveSafePath(PROJECT_ROOT, './subdir/file.txt')
    expect(result).toBe(`${PROJECT_ROOT}/subdir/file.txt`)
  })
})

// ── fsReadFile: path traversal returns path_traversal_denied ──────────────────

describe('fsReadFile', () => {
  it('returns path_traversal_denied for "../etc/passwd"', async () => {
    const result = await fsReadFile(PROJECT_ROOT, '../etc/passwd')
    expect(result.error).toBe('path_traversal_denied')
  })

  it('returns path_traversal_denied for null byte path', async () => {
    const result = await fsReadFile(PROJECT_ROOT, 'file\0etc')
    expect(result.error).toBe('path_traversal_denied')
  })

  it('returns path_traversal_denied for absolute escape', async () => {
    const result = await fsReadFile(PROJECT_ROOT, '/data/other-project/secret.txt')
    expect(result.error).toBe('path_traversal_denied')
  })
})

// ── fsListDir: path traversal returns path_traversal_denied ──────────────────

describe('fsListDir', () => {
  it('returns path_traversal_denied for "../" traversal', async () => {
    const result = await fsListDir(PROJECT_ROOT, '../')
    expect(result.error).toBe('path_traversal_denied')
  })
})

// ── Bearer token verification in server ───────────────────────────────────────

describe('createServer bearer verification', () => {
  it('returns 401 when Authorization header is missing', async () => {
    const { createServer } = await import('./index.js')
    const app = createServer({
      jwtSecret: 'test-secret',
      fsRoot: '/data',
      port: 4100,
    })

    const response = await app.inject({
      method: 'POST',
      url: '/call',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tool: 'read_file', args: { path: 'file.txt' } }),
    })

    expect(response.statusCode).toBe(401)
    const body = JSON.parse(response.body) as { error: string }
    expect(body.error).toBe('unauthorized')
  })

  it('returns 401 for an invalid Bearer token', async () => {
    const { createServer } = await import('./index.js')
    const app = createServer({
      jwtSecret: 'test-secret',
      fsRoot: '/data',
      port: 4100,
    })

    const response = await app.inject({
      method: 'POST',
      url: '/call',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer invalid.token.here',
      },
      body: JSON.stringify({ tool: 'read_file', args: { path: 'file.txt' } }),
    })

    expect(response.statusCode).toBe(401)
  })

  it('returns 200 on /health without auth', async () => {
    const { createServer } = await import('./index.js')
    const app = createServer({
      jwtSecret: 'test-secret',
      fsRoot: '/data',
      port: 4100,
    })

    const response = await app.inject({ method: 'GET', url: '/health' })
    expect(response.statusCode).toBe(200)
    const body = JSON.parse(response.body) as { ok: boolean }
    expect(body.ok).toBe(true)
  })

  it('returns 400 for unknown_tool with valid token', async () => {
    const { createServer } = await import('./index.js')
    const { signJwt } = await import('../../client/jwt-utils.js')
    const secret = 'test-secret-fs'
    const token = signJwt(
      {
        sub: 'persona-1',
        projectId: 'proj-abc123',
        connectorId: 'mcp-fs',
        scope: 'fs:read',
        argsHash: 'aabbcc',
        jti: 'jti-1',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 60,
      },
      secret,
    )

    const app = createServer({ jwtSecret: secret, fsRoot: '/data', port: 4100 })
    const response = await app.inject({
      method: 'POST',
      url: '/call',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ tool: 'nonexistent_tool', args: {} }),
    })

    expect(response.statusCode).toBe(400)
    const body = JSON.parse(response.body) as { error: string }
    expect(body.error).toBe('unknown_tool')
  })
})
