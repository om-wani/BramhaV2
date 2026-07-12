import { vi, describe, it, expect, beforeEach } from 'vitest'
import { UnauthorizedException } from '@nestjs/common'
import { ApiKeyGuard } from './api-key.guard.js'
import type { ApiKeysService } from '../api-keys.service.js'
import type { ExecutionContext } from '@nestjs/common'

const USER_ID = '550e8400-e29b-41d4-a716-446655440000'
const KEY_UUID = '6ba7b810-9dad-11d1-80b4-00c04fd430c8'

function makeContext(authHeader?: string): { ctx: ExecutionContext; req: Record<string, unknown> } {
  const req: Record<string, unknown> = {
    headers: { authorization: authHeader },
  }
  const ctx = {
    switchToHttp: () => ({
      getRequest: () => req,
    }),
  } as unknown as ExecutionContext
  return { ctx, req }
}

describe('ApiKeyGuard', () => {
  let guard: ApiKeyGuard
  let apiKeys: Partial<ApiKeysService>

  beforeEach(() => {
    apiKeys = {
      validateKey: vi.fn(),
    }
    guard = new ApiKeyGuard(apiKeys as ApiKeysService)
  })

  it('returns false (not throw) when authorization header is missing', async () => {
    const { ctx } = makeContext(undefined)
    const result = await guard.canActivate(ctx)
    expect(result).toBe(false)
  })

  it('returns false for a non-bmv2 Bearer token', async () => {
    const { ctx } = makeContext('Bearer eyJhbGciOiJFZERTQSJ9.abc.def')
    const result = await guard.canActivate(ctx)
    expect(result).toBe(false)
  })

  it('returns false for non-Bearer schemes', async () => {
    const { ctx } = makeContext('Basic dXNlcjpwYXNz')
    const result = await guard.canActivate(ctx)
    expect(result).toBe(false)
  })

  it('throws UnauthorizedException for a bmv2 token that fails validation', async () => {
    vi.mocked(apiKeys.validateKey!).mockResolvedValue(null)
    const { ctx } = makeContext('Bearer bmv2_a1b2c3d4_someSecret')

    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException)
  })

  it('sets req.user and returns true for a valid API key', async () => {
    vi.mocked(apiKeys.validateKey!).mockResolvedValue({
      userId: USER_ID,
      keyId: KEY_UUID,
      scopes: ['read'],
    })
    const { ctx, req } = makeContext('Bearer bmv2_a1b2c3d4_someSecret')

    const result = await guard.canActivate(ctx)

    expect(result).toBe(true)
    expect(req['user']).toMatchObject({
      userId: USER_ID,
      apiKeyId: KEY_UUID,
      scopes: ['read'],
    })
  })

  it('throws UnauthorizedException with API_KEY_INVALID code for invalid key format passing guard', async () => {
    vi.mocked(apiKeys.validateKey!).mockResolvedValue(null)
    const { ctx } = makeContext('Bearer bmv2_revoked_key')

    try {
      await guard.canActivate(ctx)
      expect.fail('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(UnauthorizedException)
      const unauthErr = err as UnauthorizedException
      const response = unauthErr.getResponse() as Record<string, unknown>
      expect(response['code']).toBe('api_key_invalid')
    }
  })
})
