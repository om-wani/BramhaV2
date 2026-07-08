// Public API — withTenant is the only query entry point; sql client is NOT exported
export { withTenant } from './rls.js'
export type { TenantContext } from './rls.js'

// Schema types for consumers
export type { InferSelectModel, InferInsertModel } from 'drizzle-orm'
export * from './schema/identity.js'
export * from './schema/conversations.js'
export * from './schema/artifacts.js'
export * from './schema/files.js'
export * from './schema/knowledge.js'
export * from './schema/notes.js'
