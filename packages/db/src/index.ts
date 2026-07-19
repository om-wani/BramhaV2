// Public API for @bramha/db
// withTenant() is the primary tenant-scoped entry point.
// getDb() is exported for system-level (non-tenant) use only — auth module.

export { withTenant } from './with-tenant.js';
export type { TenantContext } from './with-tenant.js';

export { getDb } from './client.js';

export { migrate } from './migrate.js';

export { getThreadAncestry, claimIngestionJob, searchKnowledge } from './queries.js';
export type { ConversationNodeRow, IngestionJobRow, KnowledgeChunk } from './queries.js';

// Schema tables — exported for Drizzle query building in apps/server
export * from './schema.js';
