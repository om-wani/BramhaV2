/**
 * ConnectorRegistry — load, cache, and validate MCP connector manifests.
 *
 * The registry is framework-agnostic: it accepts DB operations as injected
 * function deps so callers (NestJS services, agent-runtime) can provide
 * whatever persistence layer they use without this package importing @bramha/db.
 */

import { ConnectorManifestSchema } from './types.js'
import type { ConnectorManifest, RegisteredConnector } from './types.js'

// ── Dependency contract ───────────────────────────────────────────────────────

export interface ConnectorRegistryDeps {
  /**
   * Load a single connector from the DB.
   * RLS is the caller's responsibility (it runs inside withTenant).
   * Returns null if the connector is not found or not accessible.
   */
  loadConnector(connectorId: string, projectId: string | null): Promise<RegisteredConnector | null>

  /**
   * List all connectors accessible for the given project (global + project-scoped).
   */
  listConnectors(projectId: string): Promise<RegisteredConnector[]>

  /**
   * Persist a new connector and return its generated ID.
   */
  insertConnector(data: {
    projectId: string | null
    name: string
    slug: string
    manifest: ConnectorManifest
  }): Promise<string>
}

// ── Registry ──────────────────────────────────────────────────────────────────

export class ConnectorRegistry {
  /** In-memory cache keyed by `${projectId ?? 'global'}:${connectorId}` */
  private readonly cache = new Map<string, RegisteredConnector>()

  constructor(private readonly deps: ConnectorRegistryDeps) {}

  /**
   * Get a connector by ID, using the in-memory cache as a first layer.
   * Returns null if not found or disabled.
   */
  async getConnector(
    connectorId: string,
    projectId: string,
  ): Promise<RegisteredConnector | null> {
    const cacheKey = `${projectId}:${connectorId}`
    const cached = this.cache.get(cacheKey)
    if (cached) return cached

    const connector = await this.deps.loadConnector(connectorId, projectId)
    if (!connector) return null

    if (connector.enabled) {
      this.cache.set(cacheKey, connector)
    }
    return connector
  }

  /**
   * List all connectors accessible for the given project.
   */
  async listConnectors(projectId: string): Promise<RegisteredConnector[]> {
    return this.deps.listConnectors(projectId)
  }

  /**
   * Register a new connector after validating its manifest.
   * Returns the generated connector ID.
   */
  async registerConnector(
    manifest: ConnectorManifest,
    projectId: string | null,
  ): Promise<string> {
    const parsed = ConnectorManifestSchema.parse(manifest)
    return this.deps.insertConnector({
      projectId,
      name: parsed.name,
      slug: parsed.slug,
      manifest: parsed,
    })
  }

  /** Invalidate cached entry (call after updating a connector). */
  invalidate(connectorId: string, projectId: string): void {
    this.cache.delete(`${projectId}:${connectorId}`)
  }
}
