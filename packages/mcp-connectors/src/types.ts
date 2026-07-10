/**
 * Shared types for the MCP connector system.
 * ConnectorManifest is validated at registration time via ConnectorManifestSchema.
 */

import { z } from 'zod'

// ── ConnectorTool ─────────────────────────────────────────────────────────────

export const ConnectorToolSchema = z.object({
  name: z.string().min(1).max(128),
  scope: z.string().min(1).max(256),
  classification: z.enum(['read', 'write', 'execute']),
  inputSchema: z.record(z.unknown()),
  limits: z.object({
    maxResultBytes: z.number().int().positive(),
    timeoutMs: z.number().int().positive(),
  }),
})

export type ConnectorTool = z.infer<typeof ConnectorToolSchema>

// ── ConnectorManifest ─────────────────────────────────────────────────────────

export const ConnectorManifestSchema = z.object({
  slug: z.string().min(1).max(64),
  name: z.string().min(1).max(128),
  version: z.string().min(1).max(32),
  transport: z.object({
    type: z.literal('streamable-http'),
    endpoint: z.string().url(),
  }),
  auth: z.object({
    type: z.literal('capability-token'),
  }),
  tools: z.array(ConnectorToolSchema).min(1),
  egress: z.array(z.string()),
  dataClassification: z.enum(['tenant-confidential', 'public', 'internal']),
})

export type ConnectorManifest = z.infer<typeof ConnectorManifestSchema>

// ── RegisteredConnector ───────────────────────────────────────────────────────

export interface RegisteredConnector {
  id: string
  projectId: string | null
  name: string
  slug: string
  manifest: ConnectorManifest
  enabled: boolean
  createdAt: string
  updatedAt: string
}

// ── Policy types ──────────────────────────────────────────────────────────────

export type PolicyDenialReason =
  | 'no_grant'
  | 'scope_mismatch'
  | 'args_too_large'
  | 'secret_detected'
  | 'rate_limited'
  | 'approval_required'
  | 'invalid_tool'

export type PolicyResult =
  | { allowed: true; capabilityToken: string; connectorTool: ConnectorTool }
  | { allowed: false; reason: PolicyDenialReason; requiresApproval?: true }

// ── Capability token payload ───────────────────────────────────────────────────

export interface CapabilityTokenPayload {
  /** personaId */
  sub: string
  projectId: string
  connectorId: string
  scope: string
  argsHash: string
  jti: string
  iat: number
  exp: number
}

// ── Redis abstraction ─────────────────────────────────────────────────────────

/**
 * Minimal Redis interface — satisfied by ioredis.Redis at runtime.
 * Defined here to keep mcp-connectors free of an ioredis compile-time dep.
 */
export interface RedisLike {
  get(key: string): Promise<string | null>
  set(key: string, value: string | number, ...args: unknown[]): Promise<unknown>
  del(key: string): Promise<number>
  incr(key: string): Promise<number>
  expire(key: string, seconds: number): Promise<number>
}

// ── MCP result ────────────────────────────────────────────────────────────────

export interface McpResult {
  /** UTF-8 text result from the connector */
  content: string
  /** Byte length of content */
  bytes: number
}
