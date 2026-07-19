// Public API for @bramha/db
// Raw db client is intentionally NOT exported — withTenant() is the only entry point.

export { withTenant } from './with-tenant.js';
export type { TenantContext } from './with-tenant.js';

export { migrate } from './migrate.js';

export { getThreadAncestry, claimIngestionJob, searchKnowledge } from './queries.js';
export type { ConversationNodeRow, IngestionJobRow, KnowledgeChunk } from './queries.js';

// Schema tables — exported for Drizzle query building in apps/server
export * from './schema.js';
