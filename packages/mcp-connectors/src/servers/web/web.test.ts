/**
 * Web MCP server — security invariant tests.
 *
 * Tests cover:
 * - Non-allowlisted host → host_not_allowed
 * - RFC-1918 addresses → host_not_allowed (even if somehow in allowlist)
 * - Loopback addresses → host_not_allowed
 * - Allowlisted host → fetch proceeds (mocked)
 */

import { describe, it, expect, vi } from 'vitest'
import { isPrivateHost, isAllowedHost, webFetch } from './tools.js'
import type { FetchFn } from './tools.js'

// ── isPrivateHost ─────────────────────────────────────────────────────────────

describe('isPrivateHost', () => {
  it('identifies 127.0.0.1 as private (loopback)', () => {
    expect(isPrivateHost('127.0.0.1')).toBe(true)
  })

  it('identifies ::1 as private (IPv6 loopback)', () => {
    expect(isPrivateHost('::1')).toBe(true)
  })

  it('identifies localhost as private', () => {
    expect(isPrivateHost('localhost')).toBe(true)
  })

  it('identifies 10.0.0.1 as private (RFC-1918 Class A)', () => {
    expect(isPrivateHost('10.0.0.1')).toBe(true)
  })

  it('identifies 10.255.255.255 as private (RFC-1918 Class A boundary)', () => {
    expect(isPrivateHost('10.255.255.255')).toBe(true)
  })

  it('identifies 172.16.0.1 as private (RFC-1918 Class B)', () => {
    expect(isPrivateHost('172.16.0.1')).toBe(true)
  })

  it('identifies 172.31.255.255 as private (RFC-1918 Class B boundary)', () => {
    expect(isPrivateHost('172.31.255.255')).toBe(true)
  })

  it('does NOT identify 172.15.0.1 as private (just outside RFC-1918)', () => {
    expect(isPrivateHost('172.15.0.1')).toBe(false)
  })

  it('does NOT identify 172.32.0.1 as private (just outside RFC-1918)', () => {
    expect(isPrivateHost('172.32.0.1')).toBe(false)
  })

  it('identifies 192.168.1.1 as private (RFC-1918 Class C)', () => {
    expect(isPrivateHost('192.168.1.1')).toBe(true)
  })

  it('identifies 192.168.0.0 as private (RFC-1918 Class C boundary)', () => {
    expect(isPrivateHost('192.168.0.0')).toBe(true)
  })

  it('identifies 169.254.169.254 as private (AWS IMDS / link-local)', () => {
    expect(isPrivateHost('169.254.169.254')).toBe(true)
  })

  it('identifies fe80::1 as private (IPv6 link-local)', () => {
    expect(isPrivateHost('fe80::1')).toBe(true)
  })

  it('does NOT identify 8.8.8.8 as private (Google DNS)', () => {
    expect(isPrivateHost('8.8.8.8')).toBe(false)
  })

  it('does NOT identify api.github.com as private', () => {
    expect(isPrivateHost('api.github.com')).toBe(false)
  })

  it('does NOT identify 1.1.1.1 as private (Cloudflare DNS)', () => {
    expect(isPrivateHost('1.1.1.1')).toBe(false)
  })
})

// ── isAllowedHost ─────────────────────────────────────────────────────────────

describe('isAllowedHost', () => {
  const allowlist = ['api.github.com', 'docs.anthropic.com']

  it('allows exact match in allowlist', () => {
    expect(isAllowedHost('api.github.com', allowlist)).toBe(true)
  })

  it('denies a hostname not in allowlist', () => {
    expect(isAllowedHost('evil.com', allowlist)).toBe(false)
  })

  it('denies a hostname that is a subdomain of an allowlisted host (no wildcards)', () => {
    expect(isAllowedHost('sub.api.github.com', allowlist)).toBe(false)
  })

  it('is case-insensitive', () => {
    expect(isAllowedHost('API.GITHUB.COM', allowlist)).toBe(true)
  })

  it('denies empty allowlist', () => {
    expect(isAllowedHost('api.github.com', [])).toBe(false)
  })
})

// ── webFetch security ─────────────────────────────────────────────────────────

describe('webFetch', () => {
  const allowlist = ['api.github.com', 'docs.anthropic.com']

  it('denies http://evil.com/steal (not in allowlist)', async () => {
    const mockFetch: FetchFn = vi.fn()
    const result = await webFetch('http://evil.com/steal', 'GET', undefined, allowlist, mockFetch)
    expect(result.error).toBe('host_not_allowed')
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('denies http://192.168.1.1/internal (RFC-1918)', async () => {
    const mockFetch: FetchFn = vi.fn()
    // Even if we add 192.168.1.1 to the allowlist, it should be blocked
    const result = await webFetch(
      'http://192.168.1.1/internal',
      'GET',
      undefined,
      [...allowlist, '192.168.1.1'],
      mockFetch,
    )
    expect(result.error).toBe('host_not_allowed')
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('denies http://localhost/ (loopback)', async () => {
    const mockFetch: FetchFn = vi.fn()
    const result = await webFetch('http://localhost/', 'GET', undefined, allowlist, mockFetch)
    expect(result.error).toBe('host_not_allowed')
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('denies http://127.0.0.1/ (loopback IP)', async () => {
    const mockFetch: FetchFn = vi.fn()
    const result = await webFetch('http://127.0.0.1/', 'GET', undefined, allowlist, mockFetch)
    expect(result.error).toBe('host_not_allowed')
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('denies http://10.0.0.1/ (RFC-1918 Class A)', async () => {
    const mockFetch: FetchFn = vi.fn()
    const result = await webFetch('http://10.0.0.1/', 'GET', undefined, allowlist, mockFetch)
    expect(result.error).toBe('host_not_allowed')
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('denies http://169.254.169.254/ (cloud metadata endpoint)', async () => {
    const mockFetch: FetchFn = vi.fn()
    const result = await webFetch('http://169.254.169.254/', 'GET', undefined, allowlist, mockFetch)
    expect(result.error).toBe('host_not_allowed')
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('allows https://api.github.com/repos/foo/bar when in allowlist (mocked fetch)', async () => {
    const mockFetch: FetchFn = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: 123, name: 'bar' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )

    const result = await webFetch(
      'https://api.github.com/repos/foo/bar',
      'GET',
      undefined,
      allowlist,
      mockFetch,
    )

    expect(result.error).toBeUndefined()
    expect(result.statusCode).toBe(200)
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.github.com/repos/foo/bar',
      expect.objectContaining({ method: 'GET' }),
    )
  })

  it('returns { error: "response_too_large" } when response body exceeds 1 MB', async () => {
    const oneMbPlusOne = 'x'.repeat(1024 * 1024 + 1)
    const mockFetch: FetchFn = vi.fn().mockResolvedValue(
      new Response(oneMbPlusOne, {
        status: 200,
        headers: { 'content-length': String(oneMbPlusOne.length) },
      }),
    )

    const result = await webFetch(
      'https://api.github.com/big',
      'GET',
      undefined,
      allowlist,
      mockFetch,
    )

    expect(result.error).toBe('response_too_large')
  })

  it('denies an invalid URL', async () => {
    const mockFetch: FetchFn = vi.fn()
    const result = await webFetch('not-a-url', 'GET', undefined, allowlist, mockFetch)
    expect(result.error).toBe('invalid_url')
    expect(mockFetch).not.toHaveBeenCalled()
  })
})

// ── Bearer token verification ─────────────────────────────────────────────────

describe('createServer bearer verification', () => {
  it('returns 401 when Authorization header is missing', async () => {
    const { createServer } = await import('./index.js')
    const app = createServer({
      jwtSecret: 'test-secret',
      allowlist: ['api.github.com'],
      port: 4103,
      searchConfig: {},
    })

    const response = await app.inject({
      method: 'POST',
      url: '/call',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tool: 'fetch', args: { url: 'https://api.github.com/repos' } }),
    })

    expect(response.statusCode).toBe(401)
  })

  it('returns 200 on /health without auth', async () => {
    const { createServer } = await import('./index.js')
    const app = createServer({
      jwtSecret: 'test-secret',
      allowlist: ['api.github.com'],
      port: 4103,
      searchConfig: {},
    })

    const response = await app.inject({ method: 'GET', url: '/health' })
    expect(response.statusCode).toBe(200)
  })
})
