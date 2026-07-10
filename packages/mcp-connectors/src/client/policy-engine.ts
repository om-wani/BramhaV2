/**
 * PolicyEngine — zero-trust policy check for MCP tool calls.
 *
 * Implements §6.2 of docs/04_agent_orchestration_spec.md.
 * Steps (in order):
 *   1. Validate tool exists (getConnectorTool)
 *   2. Validate grant exists (getGrant)
 *   3. Scope check (grant.allowedScopes includes tool.scope)
 *   4. Classification gate (write/execute → approval_required)
 *   5. Args size limit (> 65536 bytes → args_too_large)
 *   6. Secret scan (regex on JSON → secret_detected)
 *   7. Rate limit (Redis token bucket: 30 calls / 300s per persona+connector)
 *   8. Mint capability JWT (HS256, 60s TTL)
 *   9. Mark JTI single-use (Redis SET EX 120)
 *  10. Audit log
 *  11. Return allowed result
 */

import { createHash, randomUUID } from 'node:crypto'
import { signJwt } from './jwt-utils.js'
import type { PolicyResult, ConnectorTool, RedisLike } from '../types.js'

// ── Deps ──────────────────────────────────────────────────────────────────────

export interface PolicyEngineDeps {
  redis: RedisLike
  getGrant: (
    personaId: string,
    connectorId: string,
    projectId: string,
  ) => Promise<{ allowedScopes: string[] } | null>
  getConnectorTool: (connectorId: string, toolName: string) => Promise<ConnectorTool | null>
  jwtSecret: string
}

// ── Secret scan pattern ───────────────────────────────────────────────────────
// Handles both raw `password=value` and JSON-encoded `"password":"value"` forms.
// The optional `["']?` around the separator captures the JSON closing-quote on
// the key side and the JSON opening-quote on the value side.

const SECRET_RE =
  /(?:password|secret|token|key|api.?key|credential|passwd|pwd)["']?\s*[:=]\s*["']?\S+/i

// ── PolicyEngine ──────────────────────────────────────────────────────────────

export class PolicyEngine {
  constructor(private readonly deps: PolicyEngineDeps) {}

  async checkAndMint(input: {
    personaId: string
    projectId: string
    connectorId: string
    toolName: string
    args: Record<string, unknown>
  }): Promise<PolicyResult> {
    const { personaId, projectId, connectorId, toolName, args } = input

    // Step 1 — validate tool
    const tool = await this.deps.getConnectorTool(connectorId, toolName)
    if (!tool) return { allowed: false, reason: 'invalid_tool' }

    // Step 2 — validate grant
    const grant = await this.deps.getGrant(personaId, connectorId, projectId)
    if (!grant) return { allowed: false, reason: 'no_grant' }

    // Step 3 — scope check
    if (!grant.allowedScopes.includes(tool.scope)) {
      return { allowed: false, reason: 'scope_mismatch' }
    }

    // Step 4 — classification gate (write/execute require human approval)
    if (tool.classification === 'write' || tool.classification === 'execute') {
      return { allowed: false, reason: 'approval_required', requiresApproval: true }
    }

    // Step 5 — args size check
    const argsJson = JSON.stringify(args)
    if (argsJson.length > 65_536) {
      return { allowed: false, reason: 'args_too_large' }
    }

    // Step 6 — secret scan (log hash, NOT the args themselves)
    if (SECRET_RE.test(argsJson)) {
      const argsHash = createHash('sha256').update(argsJson).digest('hex').slice(0, 16)
      console.warn('[mcp-policy] secret pattern detected in args', {
        personaId,
        connectorId,
        toolName,
        argsHash,
      })
      return { allowed: false, reason: 'secret_detected' }
    }

    // Step 7 — rate limit: token bucket (30 calls per 300 s per persona+connector)
    const rateKey = `mcp:rate:${personaId}:${connectorId}`
    const count = await this.deps.redis.incr(rateKey)
    if (count === 1) {
      await this.deps.redis.expire(rateKey, 300)
    }
    if (count > 30) {
      return { allowed: false, reason: 'rate_limited' }
    }

    // Step 8 — mint capability JWT
    const argsHash = createHash('sha256').update(argsJson).digest('hex').slice(0, 16)
    const jti = randomUUID()
    const now = Math.floor(Date.now() / 1000)
    const capabilityToken = signJwt(
      {
        sub: personaId,
        projectId,
        connectorId,
        scope: tool.scope,
        argsHash,
        jti,
        iat: now,
        exp: now + 60,
      },
      this.deps.jwtSecret,
    )

    // Step 9 — mark JTI single-use (120 s window covers 60 s token TTL with margin)
    await this.deps.redis.set(`mcp:jti:${jti}`, 1, 'EX', 120)

    // Step 10 — audit
    console.info('[mcp-policy] allowed', { personaId, connectorId, toolName, argsHash })

    // Step 11 — return
    return { allowed: true, capabilityToken, connectorTool: tool }
  }
}
