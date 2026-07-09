/**
 * Provider interface — types only.
 *
 * No vendor SDK imports in this file.
 * Vendor SDK code lives exclusively in packages/agents/src/providers/{name}.ts
 */

// ── Messages ──────────────────────────────────────────────────────────────────

export interface CoreMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
}

// ── Tools ──────────────────────────────────────────────────────────────────────

export interface ToolDefinition {
  name: string
  description?: string
  /** JSON Schema for the tool parameters */
  parameters: Record<string, unknown>
}

// ── Stream options ────────────────────────────────────────────────────────────

export interface ProviderStreamOptions {
  temperature: number
  maxOutputTokens: number
  signal?: AbortSignal
  /** Whether to hint that the system prompt prefix is stable for prompt caching */
  promptCaching?: boolean
}

// ── Stream chunks ─────────────────────────────────────────────────────────────

export type ProviderChunk =
  | { type: 'thought'; text: string }
  | { type: 'content'; text: string }
  | { type: 'tool_call'; callId: string; name: string; input: unknown }
  /**
   * Incremental usage — each event carries the delta for that step.
   * ModelRouter accumulates for budget tracking.
   */
  | { type: 'usage'; inputTokens: number; outputTokens: number; estimatedUsd: number }

// ── Provider interface ────────────────────────────────────────────────────────

export interface StreamProvider {
  /** Identifier used in ModelPolicy.primary.provider / fallbacks[].provider */
  readonly name: string
  stream(
    model: string,
    messages: CoreMessage[],
    tools: ToolDefinition[],
    opts: ProviderStreamOptions,
  ): AsyncGenerator<ProviderChunk>
}

// ── Errors ────────────────────────────────────────────────────────────────────

/**
 * Thrown by providers on retryable HTTP errors (429, 5xx).
 * ModelRouter inspects `status` to decide whether to failover.
 */
export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly provider: string,
  ) {
    super(message)
    this.name = 'ProviderError'
  }
}
