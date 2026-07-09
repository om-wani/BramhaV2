// Embedding providers
export * from './embedder.js'

// Token counting
export * from './token-count.js'

// Provider types (no vendor SDK)
export type { StreamProvider, CoreMessage, ToolDefinition, ProviderStreamOptions, ProviderChunk } from './providers/types.js'
export { ProviderError } from './providers/types.js'

// ModelRouter
export {
  ModelRouter,
  BudgetExceededError,
  DailyBudgetExceededError,
  clearCircuitBreakers,
  clearProviderCache,
} from './model-router.js'
export type {
  ModelPolicy,
  StreamEvent,
  WriteTokenUsageInput,
  WriteTokenUsageFn,
  ModelRouterChatOptions,
} from './model-router.js'

// Semantic cache
export { SemanticCache, cosineSimilarity } from './semantic-cache.js'
export type { CachedResult } from './semantic-cache.js'

// Persona compiler
export { compilePersona, bustPersonaCache, getPersonaCacheSize } from './persona.js'
export type { CompileOptions, CompiledPersona } from './persona.js'
