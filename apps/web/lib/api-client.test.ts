/**
 * api-client rate-limit/refresh flow tests.
 *
 * Covers the 401 -> silent refresh -> retry path, and the fallback when the
 * refresh itself fails (session fully expired, not just the access token).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { z } from 'zod'

const redirectToLoginMock = vi.fn()
vi.mock('./auth', () => ({ redirectToLogin: redirectToLoginMock }))

const Schema = z.object({ ok: z.boolean() })

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('api-client', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.resetModules()
    redirectToLoginMock.mockClear()
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    Object.defineProperty(window, 'location', {
      value: { pathname: '/dashboard', search: '?x=1', origin: 'http://localhost:3000' },
      writable: true,
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('retries once after a successful silent refresh on 401', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(401, { code: 'invalid_token' })) // original request
      .mockResolvedValueOnce(jsonResponse(200, {})) // /auth/refresh
      .mockResolvedValueOnce(jsonResponse(200, { ok: true })) // retried request

    const { api } = await import('./api-client')
    const result = await api.get('/projects/p1', Schema)

    expect(result).toEqual({ ok: true })
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(fetchMock.mock.calls[1]![0]).toContain('/auth/refresh')
    expect(redirectToLoginMock).not.toHaveBeenCalled()
  })

  it('redirects to login (preserving the current path) when refresh itself fails', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(401, { code: 'invalid_token' })) // original request
      .mockResolvedValueOnce(jsonResponse(401, { code: 'token_invalid' })) // /auth/refresh fails

    const { api } = await import('./api-client')
    await expect(api.get('/projects/p1', Schema)).rejects.toThrow()

    expect(redirectToLoginMock).toHaveBeenCalledWith('/dashboard?x=1')
  })

  it('does not attempt a refresh loop for /auth/login itself', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(401, { code: 'invalid_credentials' }))

    const { api } = await import('./api-client')
    await expect(
      api.post('/auth/login', Schema, { email: 'a@b.com', password: 'x' }),
    ).rejects.toThrow()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(redirectToLoginMock).not.toHaveBeenCalled()
  })

  it('concurrent 401s share a single in-flight refresh call', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(401, {})) // request A
      .mockResolvedValueOnce(jsonResponse(401, {})) // request B
      .mockResolvedValueOnce(jsonResponse(200, {})) // /auth/refresh (shared)
      .mockResolvedValueOnce(jsonResponse(200, { ok: true })) // retried A
      .mockResolvedValueOnce(jsonResponse(200, { ok: true })) // retried B

    const { api } = await import('./api-client')
    await Promise.all([api.get('/a', Schema), api.get('/b', Schema)])

    const refreshCalls = fetchMock.mock.calls.filter((c) => String(c[0]).includes('/auth/refresh'))
    expect(refreshCalls).toHaveLength(1)
  })
})
