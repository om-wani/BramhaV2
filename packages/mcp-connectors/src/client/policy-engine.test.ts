import { describe, it, expect, vi } from 'vitest'
import { PolicyEngine } from './policy-engine.js'
import { verifyJwtSignature } from './jwt-utils.js'
import type { ConnectorTool, RedisLike } from '../types.js'

// ── Constants ─────────────────────────────────────────────────────────────────

const PERSONA_ID = 'persona-aaa-111'
const PROJECT_ID = 'project-bbb-222'
const CONNECTOR_ID = 'connector-ccc-333'
const JWT_SECRET = 'test-secret-xyz'

const READ_TOOL: ConnectorTool = {
  name: 'query_data',
  scope: 'data:read',
  classification: 'read',
  inputSchema: { type: 'object' },
  limits: { maxResultBytes: 65536, timeoutMs: 5000 },
}

const WRITE_TOOL: ConnectorTool = {
  name: 'update_record',
  scope: 'data:write',
  classification: 'write',
  inputSchema: { type: 'object' },
  limits: { maxResultBytes: 1024, timeoutMs: 3000 },
}

// ── Redis mock ────────────────────────────────────────────────────────────────

function makeRedisMock(incrValue = 1): RedisLike {
  return {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue('OK'),
    del: vi.fn().mockResolvedValue(1),
    incr: vi.fn().mockResolvedValue(incrValue),
    expire: vi.fn().mockResolvedValue(1),
    zrank: vi.fn().mockResolvedValue(null),
    zadd: vi.fn().mockResolvedValue(0),
    zremrangebyscore: vi.fn().mockResolvedValue(0),
  }
}

// ── Engine factory ────────────────────────────────────────────────────────────

function makeEngine({
  tool = READ_TOOL as ConnectorTool | null,
  grant = { allowedScopes: [READ_TOOL.scope] } as { allowedScopes: string[] } | null,
  redis = makeRedisMock(),
}: {
  tool?: ConnectorTool | null
  grant?: { allowedScopes: string[] } | null
  redis?: RedisLike
} = {}) {
  const getConnectorTool = vi.fn().mockResolvedValue(tool)
  const getGrant = vi.fn().mockResolvedValue(grant)
  const engine = new PolicyEngine({ redis, getGrant, getConnectorTool, jwtSecret: JWT_SECRET })
  return { engine, getConnectorTool, getGrant, redis }
}

function baseInput(overrides: Partial<Parameters<PolicyEngine['checkAndMint']>[0]> = {}) {
  return {
    personaId: PERSONA_ID,
    projectId: PROJECT_ID,
    connectorId: CONNECTOR_ID,
    toolName: 'query_data',
    args: { q: 'hello' },
    ...overrides,
  }
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('PolicyEngine.checkAndMint', () => {
  // 1. invalid_tool
  it('returns invalid_tool when getConnectorTool returns null', async () => {
    const { engine } = makeEngine({ tool: null })
    const result = await engine.checkAndMint(baseInput())
    expect(result).toEqual({ allowed: false, reason: 'invalid_tool' })
  })

  // 2. no_grant
  it('returns no_grant when getGrant returns null', async () => {
    const { engine } = makeEngine({ grant: null })
    const result = await engine.checkAndMint(baseInput())
    expect(result).toEqual({ allowed: false, reason: 'no_grant' })
  })

  // 3. scope_mismatch
  it('returns scope_mismatch when grant does not include tool scope', async () => {
    const { engine } = makeEngine({ grant: { allowedScopes: ['other:scope'] } })
    const result = await engine.checkAndMint(baseInput())
    expect(result).toEqual({ allowed: false, reason: 'scope_mismatch' })
  })

  // 3.5. schema validation
  it('returns scope_mismatch when args fail JSON Schema validation', async () => {
    const strictTool: ConnectorTool = {
      ...READ_TOOL,
      inputSchema: {
        type: 'object',
        properties: { q: { type: 'string' } },
        required: ['q'],
        additionalProperties: false,
      },
    }
    const { engine } = makeEngine({ tool: strictTool, grant: { allowedScopes: [strictTool.scope] } })
    // Pass a number where string is required
    const result = await engine.checkAndMint(baseInput({ args: { q: 42 } }))
    expect(result).toEqual({ allowed: false, reason: 'scope_mismatch' })
  })

  // 4. approval_required (write tool)
  it('returns approval_required for write-classified tool', async () => {
    const { engine } = makeEngine({
      tool: WRITE_TOOL,
      grant: { allowedScopes: [WRITE_TOOL.scope] },
    })
    const result = await engine.checkAndMint(baseInput({ toolName: 'update_record' }))
    expect(result).toEqual({
      allowed: false,
      reason: 'approval_required',
      requiresApproval: true,
    })
  })

  // 5. args_too_large
  it('returns args_too_large when JSON args exceed 65536 bytes', async () => {
    const { engine } = makeEngine()
    const bigArgs = { data: 'x'.repeat(65_537) }
    const result = await engine.checkAndMint(baseInput({ args: bigArgs }))
    expect(result).toEqual({ allowed: false, reason: 'args_too_large' })
  })

  // 6. secret_detected
  it('returns secret_detected when args contain a password-like field', async () => {
    const { engine } = makeEngine()
    const secretArgs = { password: 'abc123' }
    const result = await engine.checkAndMint(baseInput({ args: secretArgs }))
    expect(result).toEqual({ allowed: false, reason: 'secret_detected' })
  })

  // 7. rate_limited
  it('returns rate_limited when Redis INCR exceeds 30', async () => {
    const redis = makeRedisMock(31)
    const { engine } = makeEngine({ redis })
    const result = await engine.checkAndMint(baseInput())
    expect(result).toEqual({ allowed: false, reason: 'rate_limited' })
  })

  // 8. happy path — returns allowed: true with capabilityToken
  it('returns allowed: true with capabilityToken on valid read tool', async () => {
    const { engine } = makeEngine()
    const result = await engine.checkAndMint(baseInput())
    expect(result.allowed).toBe(true)
    if (result.allowed) {
      expect(typeof result.capabilityToken).toBe('string')
      expect(result.capabilityToken.split('.').length).toBe(3) // JWT
      expect(result.connectorTool).toEqual(READ_TOOL)
    }
  })

  // 9. JWT claims in happy path
  it('JWT contains correct sub, scope, argsHash claims', async () => {
    const { engine } = makeEngine()
    const args = { q: 'hello' }
    const result = await engine.checkAndMint(baseInput({ args }))
    expect(result.allowed).toBe(true)
    if (result.allowed) {
      const payload = verifyJwtSignature<Record<string, unknown>>(
        result.capabilityToken,
        JWT_SECRET,
      )
      expect(payload['sub']).toBe(PERSONA_ID)
      expect(payload['scope']).toBe(READ_TOOL.scope)
      expect(payload['projectId']).toBe(PROJECT_ID)
      expect(payload['connectorId']).toBe(CONNECTOR_ID)
      expect(typeof payload['argsHash']).toBe('string')
      expect((payload['argsHash'] as string).length).toBe(16)
      expect(typeof payload['jti']).toBe('string')
      expect(typeof payload['exp']).toBe('number')
    }
  })
})
