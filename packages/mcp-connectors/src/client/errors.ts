/**
 * Error classes for the MCP connector client.
 */

import type { PolicyDenialReason } from '../types.js'

/** Thrown when a policy check denies a tool call. */
export class McpDeniedError extends Error {
  constructor(
    public readonly reason: PolicyDenialReason,
    public readonly requiresApproval = false,
  ) {
    super(`MCP call denied: ${reason}`)
    this.name = 'McpDeniedError'
  }
}

/** Thrown when an MCP connector returns an HTTP error or malformed response. */
export class McpCallError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
  ) {
    super(message)
    this.name = 'McpCallError'
  }
}

/** Thrown by verifyCapabilityToken for token-level errors. */
export class CapabilityTokenError extends Error {
  constructor(public readonly code: 'expired' | 'invalid_signature' | 'jti_replayed') {
    super(`Capability token error: ${code}`)
    this.name = 'CapabilityTokenError'
  }
}
