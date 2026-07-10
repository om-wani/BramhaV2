/**
 * verifyCapabilityToken — verify a capability JWT before processing an MCP call.
 *
 * Responsibilities:
 *   1. Verify JWT signature + expiry (via jwt-utils.ts verifyJwtSignature)
 *   2. Consume JTI from Redis (DEL) — replay protection; 0 returned = already used
 *   3. Return typed payload
 *
 * Errors thrown as McpCallError (message = code string):
 *   'expired'           — JWT exp in the past
 *   'invalid_signature' — tampered token or bad secret
 *   'jti_replayed'      — JTI already consumed (replay attack)
 */

import { verifyJwtSignature } from './jwt-utils.js'
import { McpCallError, CapabilityTokenError } from './errors.js'
import type { CapabilityTokenPayload, RedisLike } from '../types.js'

export async function verifyCapabilityToken(
  token: string,
  redis: RedisLike,
  jwtSecret: string,
): Promise<CapabilityTokenPayload> {
  // Step 1 — verify signature + expiry
  // verifyJwtSignature<T> constrains T extends Record<string, unknown>; we cast
  // after verification since CapabilityTokenPayload has narrower field types.
  let payload: CapabilityTokenPayload
  try {
    const raw = verifyJwtSignature<Record<string, unknown>>(token, jwtSecret)
    payload = raw as unknown as CapabilityTokenPayload
  } catch (err) {
    if (err instanceof CapabilityTokenError) {
      // Map CapabilityTokenError codes → McpCallError messages
      throw new McpCallError(err.code)
    }
    throw new McpCallError('invalid_signature')
  }

  // Step 2 — consume JTI (single-use replay protection)
  const deleted = await redis.del(`mcp:jti:${payload.jti}`)
  if (deleted === 0) {
    throw new McpCallError('jti_replayed')
  }

  // Step 3 — return verified payload
  return payload
}
