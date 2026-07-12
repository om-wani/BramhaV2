import { describe, it, expect, vi } from 'vitest'
import { verifyCapabilityToken } from './capability-token.js'
import { signJwt } from './jwt-utils.js'
import { McpCallError } from './errors.js'
import type { RedisLike } from '../types.js'

// ── Constants ─────────────────────────────────────────────────────────────────

const JWT_SECRET = 'test-cap-secret'
const PERSONA_ID = 'persona-aaa-111'
const PROJECT_ID = 'project-bbb-222'
const CONNECTOR_ID = 'connector-ccc-333'

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeValidPayload(overrides: Record<string, unknown> = {}) {
  const now = Math.floor(Date.now() / 1000)
  return {
    sub: PERSONA_ID,
    projectId: PROJECT_ID,
    connectorId: CONNECTOR_ID,
    scope: 'data:read',
    argsHash: 'abc123def456abcd',
    jti: 'test-jti-uuid',
    iat: now,
    exp: now + 60,
    ...overrides,
  }
}

function makeRedisMock(delReturn: number): RedisLike {
  return {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue('OK'),
    del: vi.fn().mockResolvedValue(delReturn),
    incr: vi.fn().mockResolvedValue(1),
    expire: vi.fn().mockResolvedValue(1),
    zrank: vi.fn().mockResolvedValue(null),
    zadd: vi.fn().mockResolvedValue(0),
    zremrangebyscore: vi.fn().mockResolvedValue(0),
  }
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('verifyCapabilityToken', () => {
  // 1. Valid token + Redis DEL=1 → verifies successfully
  it('returns payload for a valid token when JTI is not yet consumed', async () => {
    const payload = makeValidPayload()
    const token = signJwt(payload, JWT_SECRET)
    const redis = makeRedisMock(1)

    const result = await verifyCapabilityToken(token, redis, JWT_SECRET)

    expect(result.sub).toBe(PERSONA_ID)
    expect(result.projectId).toBe(PROJECT_ID)
    expect(result.connectorId).toBe(CONNECTOR_ID)
    expect(result.scope).toBe('data:read')
    expect(redis.del).toHaveBeenCalledWith(`mcp:jti:${payload.jti}`)
  })

  // 2. Expired token → throws McpCallError('expired')
  it('throws McpCallError("expired") for an expired token', async () => {
    const now = Math.floor(Date.now() / 1000)
    const payload = makeValidPayload({ exp: now - 10 }) // expired 10 seconds ago
    const token = signJwt(payload, JWT_SECRET)
    const redis = makeRedisMock(1)

    await expect(verifyCapabilityToken(token, redis, JWT_SECRET)).rejects.toThrow(
      McpCallError,
    )
    await expect(verifyCapabilityToken(token, redis, JWT_SECRET)).rejects.toMatchObject({
      message: 'expired',
    })
  })

  // 3. Invalid signature → throws McpCallError('invalid_signature')
  it('throws McpCallError("invalid_signature") for a tampered token', async () => {
    const payload = makeValidPayload()
    const token = signJwt(payload, JWT_SECRET)
    const tamperedToken = token.slice(0, -4) + 'XXXX' // corrupt the signature
    const redis = makeRedisMock(1)

    await expect(verifyCapabilityToken(tamperedToken, redis, JWT_SECRET)).rejects.toThrow(
      McpCallError,
    )
    await expect(
      verifyCapabilityToken(tamperedToken, redis, JWT_SECRET),
    ).rejects.toMatchObject({ message: 'invalid_signature' })
  })

  // 4. Replayed JTI (DEL returns 0) → throws McpCallError('jti_replayed')
  it('throws McpCallError("jti_replayed") when JTI is already consumed', async () => {
    const payload = makeValidPayload()
    const token = signJwt(payload, JWT_SECRET)
    const redis = makeRedisMock(0) // DEL returns 0 = key did not exist

    await expect(verifyCapabilityToken(token, redis, JWT_SECRET)).rejects.toThrow(
      McpCallError,
    )
    await expect(verifyCapabilityToken(token, redis, JWT_SECRET)).rejects.toMatchObject({
      message: 'jti_replayed',
    })
  })
})
