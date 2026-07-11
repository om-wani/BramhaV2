// Public API — withTenant and withAdmin are the only query entry points; sql client is NOT exported
export { withTenant, withAdmin } from './rls.js'
export type { TenantContext } from './rls.js'

// Schema types for consumers
export type { InferSelectModel, InferInsertModel } from 'drizzle-orm'
export * from './schema/identity.js'
export * from './schema/conversations.js'
export * from './schema/artifacts.js'
export * from './schema/files.js'
export * from './schema/knowledge.js'
export * from './schema/notes.js'
export * from './schema/agents.js'
export * from './schema/orchestration.js'
