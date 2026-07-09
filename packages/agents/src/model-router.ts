/**
 * ModelRouter — normalised LLM streaming with failover, circuit breaker, and budget enforcement.
 *
 * This file MUST NOT import any vendor SDK directly.
 * All vendor SDK code lives in packages/agents/src/providers/{name}.ts.
 * Providers are loaded via dynamic import on first call to avoid vendor SDK
 * leaking into the module graph for code that doesn't need it.
 *
 * Security:
 *   - API keys never read or logged here; provider files handle that.
 *   - Message content never logged; only counts and IDs.
 *   - Provider errors are normalised before propagation (raw SDK errors redacted).
 */

import type { StreamProvider, CoreMessage, ToolDefinition, ProviderChunk } from './providers/types.js'
import { ProviderError } from './providers/types.js'

// ── Public types ──────────────────────────────────────────────────────────────

export interface ModelPolicy {
  tier: 'csuite' | 'specialist' | 'utility'
  primary: { provider: string; model: string }
  fallbacks: { provider: string; model: string }[]
  maxInputTokens: number
  maxOutputTokens: number
  temperature: number
  budget: { perTurnUSD: number; perDayUSD: number }
  cache: { promptCaching: boolean; semanticCacheTTLs: number }
}

export type StreamEvent =
  | { type: 'thought'; text: string }
  | { type: 'content'; text: string }
  | { type: 'tool_call'; callId: string; name: string; input: unknown }
  | { type: 'usage'; inputTokens: number; outputTokens: number; estimatedUsd: number }

export interface WriteTokenUsageInput {
  projectId: string
  personaId?: string | undefined
  conversationNodeId?: string | undefined
  turnId?: string | undefined
  provider: string
  model: string
  inputTokens: number
  outputTokens: number
  estimatedUsd: number
}

export type WriteTokenUsageFn = (input: WriteTokenUsageInput) => Promise<void>

export interface ModelRouterChatOptions {
  writeTokenUsage?: WriteTokenUsageFn
  writeTokenUsageContext?: {
    projectId: string
    personaId?: string | undefined
    conversationNodeId?: string | undefined
    turnId?: string | undefined
  }
  /**
   * Injectable provider factory — used in tests to supply mock providers.
   * Production callers omit this; ModelRouter uses dynamic imports.
   */
  providerFactory?: (providerName: string) => StreamProvider
}

// ── Budget exceeded error ──────────────────────────────────────────────────────

export class BudgetExceededError extends Error {
  constructor(
    public readonly spentUsd: number,
    public readonly limitUsd: number,
  ) {
    super(`Budget exceeded: spent $${spentUsd.toFixed(6)} of $${limitUsd.toFixed(4)} limit`)
    this.name = 'BudgetExceededError'
  }
}

// ── Circuit breaker ───────────────────────────────────────────────────────────

class CircuitBreaker {
  private failures = 0
  private openedAt: number | null = null

  private readonly maxFailures: number
  private readonly openDurationMs: number

  constructor(maxFailures = 5, openDurationMs = 60_000) {
    this.maxFailures = maxFailures
    this.openDurationMs = openDurationMs
  }

  isOpen(): boolean {
    if (this.openedAt === null) return false
    if (Date.now() - this.openedAt >= this.openDurationMs) {
      // Half-open: allow one attempt
      this.failures = 0
      this.openedAt = null
      return false
    }
    return true
  }

  recordFailure(): void {
    this.failures++
    if (this.failures >= this.maxFailures) {
      this.openedAt = Date.now()
    }
  }

  recordSuccess(): void {
    this.failures = 0
    this.openedAt = null
  }

  reset(): void {
    this.failures = 0
    this.openedAt = null
  }
}

// Module-level circuit breaker registry (per provider name)
const circuitBreakers = new Map<string, CircuitBreaker>()

function getCircuitBreaker(providerName: string): CircuitBreaker {
  let cb = circuitBreakers.get(providerName)
  if (!cb) {
    cb = new CircuitBreaker()
    circuitBreakers.set(providerName, cb)
  }
  return cb
}

/**
 * Reset all circuit breakers — intended for test cleanup.
 * Do NOT call in production code.
 */
export function clearCircuitBreakers(): void {
  circuitBreakers.clear()
}

// ── Provider registry (dynamic import, cached per provider name) ───────────────

const providerCache = new Map<string, StreamProvider>()

async function resolveProvider(
  name: string,
  factory?: (n: string) => StreamProvider,
): Promise<StreamProvider> {
  // 1. Test/injection path
  if (factory) return factory(name)

  // 2. Production path: dynamic import (deferred loading, no vendor SDK at module-load time)
  const cached = providerCache.get(name)
  if (cached) return cached

  let provider: StreamProvider
  if (name === 'anthropic') {
    const mod = await import('./providers/anthropic.js')
    provider = mod.createAnthropicProvider()
  } else if (name === 'openai') {
    const mod = await import('./providers/openai.js')
    provider = mod.createOpenAIProvider()
  } else if (name === 'ollama') {
    const mod = await import('./providers/ollama.js')
    provider = mod.createOllamaProvider()
  } else {
    throw new Error(`Unknown provider: ${name}`)
  }

  providerCache.set(name, provider)
  return provider
}

/** Clear the provider cache (useful after provider config changes in tests). */
export function clearProviderCache(): void {
  providerCache.clear()
}

// ── Error classification ───────────────────────────────────────────────────────

/**
 * Returns true if the error is a transient provider error that should trigger
 * failover (HTTP 429 or 5xx).
 */
function isRetryableError(err: unknown): boolean {
  if (err instanceof ProviderError) return true
  // Detect AI SDK APICallError or other error shapes with a `status` field
  const status = (err as { status?: unknown })?.status
  return typeof status === 'number' && (status === 429 || status >= 500)
}

// ── ModelRouter ───────────────────────────────────────────────────────────────

export class ModelRouter {
  /**
   * Stream a normalized LLM response.
   *
   * Failover ladder:
   *   policy.primary → policy.fallbacks[0] → ... → throws AllProvidersFailedError
   *
   * Budget enforcement:
   *   Accumulates estimatedUsd from each `usage` event. If the running total
   *   exceeds policy.budget.perTurnUSD, throws BudgetExceededError and writes
   *   partial usage.
   *
   * @param policy - Agent model policy (loaded from DB, hot-reloadable per call)
   * @param messages - Conversation messages
   * @param tools - Available tools for this turn
   * @param signal - Abort signal (e.g. from request timeout)
   * @param opts - Injectable options for testing and usage accounting
   */
  static async *chat(
    policy: ModelPolicy,
    messages: CoreMessage[],
    tools: ToolDefinition[],
    signal?: AbortSignal,
    opts?: ModelRouterChatOptions,
  ): AsyncGenerator<StreamEvent> {
    // Build the ordered candidate list: primary first, then fallbacks
    const candidates: { provider: string; model: string }[] = [
      policy.primary,
      ...policy.fallbacks,
    ]

    // Try each candidate in order
    let lastError: unknown = null
    let successProvider: string | null = null
    let successModel: string | null = null

    let totalInputTokens = 0
    let totalOutputTokens = 0
    let totalUsd = 0

    for (const candidate of candidates) {
      const cb = getCircuitBreaker(candidate.provider)

      if (cb.isOpen()) {
        // Skip this provider — circuit is open
        continue
      }

      let provider: StreamProvider
      try {
        provider = await resolveProvider(candidate.provider, opts?.providerFactory)
      } catch (err) {
        lastError = err
        continue
      }

      let succeeded = false

      try {
        for await (const chunk of provider.stream(candidate.model, messages, tools, {
          temperature: policy.temperature,
          maxOutputTokens: policy.maxOutputTokens,
          promptCaching: policy.cache.promptCaching,
          // exactOptionalPropertyTypes: omit rather than pass undefined
          ...(signal !== undefined ? { signal } : {}),
        }) as AsyncGenerator<ProviderChunk>) {
          if (chunk.type === 'usage') {
            totalInputTokens += chunk.inputTokens
            totalOutputTokens += chunk.outputTokens
            totalUsd += chunk.estimatedUsd

            // Yield the usage event before budget check
            yield {
              type: 'usage',
              inputTokens: chunk.inputTokens,
              outputTokens: chunk.outputTokens,
              estimatedUsd: chunk.estimatedUsd,
            }

            // Budget check — abort mid-stream if exceeded
            if (totalUsd > policy.budget.perTurnUSD) {
              // Write partial usage before aborting
              await opts?.writeTokenUsage?.({
                ...opts.writeTokenUsageContext,
                projectId: opts.writeTokenUsageContext?.projectId ?? '',
                provider: candidate.provider,
                model: candidate.model,
                inputTokens: totalInputTokens,
                outputTokens: totalOutputTokens,
                estimatedUsd: totalUsd,
              })
              throw new BudgetExceededError(totalUsd, policy.budget.perTurnUSD)
            }
          } else {
            yield chunk as StreamEvent
          }
        }

        // Stream completed successfully
        succeeded = true
        successProvider = candidate.provider
        successModel = candidate.model
        cb.recordSuccess()
        break
      } catch (err) {
        if (err instanceof BudgetExceededError) {
          // Rethrow immediately — do not try fallbacks for budget exceeded
          throw err
        }

        if (isRetryableError(err)) {
          // Retryable error — record failure and try next candidate
          cb.recordFailure()
          lastError = err
          continue
        }

        // Non-retryable error — rethrow
        throw err
      } finally {
        if (succeeded) {
          // Write complete usage on success
          await opts?.writeTokenUsage?.({
            ...opts.writeTokenUsageContext,
            projectId: opts.writeTokenUsageContext?.projectId ?? '',
            provider: successProvider ?? candidate.provider,
            model: successModel ?? candidate.model,
            inputTokens: totalInputTokens,
            outputTokens: totalOutputTokens,
            estimatedUsd: totalUsd,
          })
        }
      }
    }

    // If we exhausted all candidates without success, throw the last error
    if (successProvider === null) {
      if (lastError) throw lastError
      throw new Error('All providers skipped (circuit breakers open)')
    }
  }
}
