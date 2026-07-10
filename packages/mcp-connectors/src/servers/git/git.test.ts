/**
 * Git MCP server — security invariant tests.
 *
 * Tests cover:
 * - ssh:// URL → scheme_not_allowed
 * - file:// URL → scheme_not_allowed
 * - git:// URL → scheme_not_allowed
 * - Path traversal within clone → path_traversal_denied
 * - https:// URL → accepted (mock git exec, no real clone)
 */

import { describe, it, expect, vi } from 'vitest'
import {
  validateRepoUrl,
  SchemeNotAllowedError,
  PathTraversalError,
  resolveSafeClonePath,
  cloneDir,
  gitClone,
} from './tools.js'
import type { GitExecFn } from './tools.js'

// ── validateRepoUrl ───────────────────────────────────────────────────────────

describe('validateRepoUrl', () => {
  it('throws SchemeNotAllowedError for ssh:// URLs', () => {
    expect(() => validateRepoUrl('ssh://github.com/org/repo')).toThrow(SchemeNotAllowedError)
  })

  it('throws SchemeNotAllowedError for git:// URLs', () => {
    expect(() => validateRepoUrl('git://github.com/org/repo')).toThrow(SchemeNotAllowedError)
  })

  it('throws SchemeNotAllowedError for file:// URLs', () => {
    expect(() => validateRepoUrl('file:///etc/passwd')).toThrow(SchemeNotAllowedError)
  })

  it('throws SchemeNotAllowedError for http:// URLs (not https)', () => {
    expect(() => validateRepoUrl('http://github.com/org/repo')).toThrow(SchemeNotAllowedError)
  })

  it('throws SchemeNotAllowedError for malformed URLs', () => {
    expect(() => validateRepoUrl('not a url at all')).toThrow(SchemeNotAllowedError)
  })

  it('accepts https:// URLs', () => {
    expect(() => validateRepoUrl('https://github.com/org/repo')).not.toThrow()
  })

  it('accepts git+https:// URLs', () => {
    expect(() => validateRepoUrl('git+https://github.com/org/repo.git')).not.toThrow()
  })
})

// ── resolveSafeClonePath ──────────────────────────────────────────────────────

describe('resolveSafeClonePath', () => {
  const CLONE_ROOT = '/tmp/mcp-git/proj-abc/abcdef1234567890'

  it('denies "../etc/passwd" path traversal', async () => {
    await expect(resolveSafeClonePath(CLONE_ROOT, '../etc/passwd')).rejects.toThrow(
      PathTraversalError,
    )
  })

  it('denies nested traversal "a/../../etc/passwd"', async () => {
    await expect(resolveSafeClonePath(CLONE_ROOT, 'a/../../etc/passwd')).rejects.toThrow(
      PathTraversalError,
    )
  })

  it('denies null byte in path', async () => {
    await expect(resolveSafeClonePath(CLONE_ROOT, 'file\0.txt')).rejects.toThrow(
      PathTraversalError,
    )
  })

  it('denies absolute path escape', async () => {
    await expect(resolveSafeClonePath(CLONE_ROOT, '/etc/passwd')).rejects.toThrow(
      PathTraversalError,
    )
  })

  it('accepts valid relative path "src/index.ts"', async () => {
    // File doesn't exist on disk — symlink check is skipped (ENOENT)
    const result = await resolveSafeClonePath(CLONE_ROOT, 'src/index.ts')
    expect(result).toBe(`${CLONE_ROOT}/src/index.ts`)
  })
})

// ── gitClone with mocked exec ─────────────────────────────────────────────────

describe('gitClone', () => {
  it('rejects ssh:// URL with scheme_not_allowed', async () => {
    const mockExec: GitExecFn = vi.fn()
    const result = await gitClone('/tmp/git', 'proj-1', 'ssh://github.com/org/repo', undefined, mockExec)
    expect(result.error).toBe('scheme_not_allowed')
    expect(mockExec).not.toHaveBeenCalled()
  })

  it('rejects file:// URL with scheme_not_allowed', async () => {
    const mockExec: GitExecFn = vi.fn()
    const result = await gitClone('/tmp/git', 'proj-1', 'file:///etc/passwd', undefined, mockExec)
    expect(result.error).toBe('scheme_not_allowed')
    expect(mockExec).not.toHaveBeenCalled()
  })

  it('accepts https:// URL and calls git clone (mocked)', async () => {
    const mockExec: GitExecFn = vi.fn().mockResolvedValue({ stdout: 'size-pack: 100\n', stderr: '' })
    await gitClone(
      '/tmp/git',
      'proj-1',
      'https://github.com/org/repo',
      undefined,
      mockExec,
    )
    // Should have called git (scheme was accepted)
    expect(mockExec).toHaveBeenCalled()
    const firstCall = (mockExec as ReturnType<typeof vi.fn>).mock.calls[0] as [string[], string?]
    expect(firstCall[0]).toContain('clone')
    expect(firstCall[0]).toContain('https://github.com/org/repo')
    // No push args ever passed
    expect(firstCall[0]).not.toContain('push')
  })

  it('never passes "push" in git args for any operation', async () => {
    const seenArgs: string[][] = []
    const mockExec: GitExecFn = async (args) => {
      seenArgs.push(args)
      return { stdout: '', stderr: '' }
    }
    await gitClone('/tmp/git', 'proj-1', 'https://github.com/org/repo', undefined, mockExec)
    for (const args of seenArgs) {
      expect(args).not.toContain('push')
    }
  })
})

// ── cloneDir determinism ──────────────────────────────────────────────────────

describe('cloneDir', () => {
  it('produces a deterministic path for the same URL', () => {
    const d1 = cloneDir('/tmp/mcp-git', 'proj-abc', 'https://github.com/org/repo')
    const d2 = cloneDir('/tmp/mcp-git', 'proj-abc', 'https://github.com/org/repo')
    expect(d1).toBe(d2)
  })

  it('produces different paths for different URLs', () => {
    const d1 = cloneDir('/tmp/mcp-git', 'proj-abc', 'https://github.com/org/repo1')
    const d2 = cloneDir('/tmp/mcp-git', 'proj-abc', 'https://github.com/org/repo2')
    expect(d1).not.toBe(d2)
  })

  it('produces different paths for different projects', () => {
    const d1 = cloneDir('/tmp/mcp-git', 'proj-abc', 'https://github.com/org/repo')
    const d2 = cloneDir('/tmp/mcp-git', 'proj-def', 'https://github.com/org/repo')
    expect(d1).not.toBe(d2)
  })
})

// ── Bearer token verification ─────────────────────────────────────────────────

describe('createServer bearer verification', () => {
  it('returns 401 when Authorization header is missing', async () => {
    const { createServer } = await import('./index.js')
    const app = createServer({ jwtSecret: 'test-secret', gitRoot: '/tmp/mcp-git', port: 4102 })

    const response = await app.inject({
      method: 'POST',
      url: '/call',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tool: 'clone', args: { repoUrl: 'https://github.com/org/repo' } }),
    })

    expect(response.statusCode).toBe(401)
  })
})
