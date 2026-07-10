// ── Registry ──────────────────────────────────────────────────────────────────
export { ConnectorRegistry } from './registry.js'
export type { ConnectorRegistryDeps } from './registry.js'

// ── Types ─────────────────────────────────────────────────────────────────────
export {
  ConnectorToolSchema,
  ConnectorManifestSchema,
} from './types.js'
export type {
  ConnectorTool,
  ConnectorManifest,
  RegisteredConnector,
  PolicyDenialReason,
  PolicyResult,
  CapabilityTokenPayload,
  RedisLike,
  McpResult,
} from './types.js'

// ── Client — policy engine ────────────────────────────────────────────────────
export { PolicyEngine } from './client/policy-engine.js'
export type { PolicyEngineDeps } from './client/policy-engine.js'

// ── Client — capability token ─────────────────────────────────────────────────
export { verifyCapabilityToken } from './client/capability-token.js'

// ── Client — MCP HTTP client ──────────────────────────────────────────────────
export { McpClient } from './client/mcp-client.js'

// ── Client — errors ───────────────────────────────────────────────────────────
export { McpDeniedError, McpCallError, CapabilityTokenError } from './client/errors.js'
