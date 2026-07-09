/**
 * Anthropic provider — ONLY file allowed to import @ai-sdk/anthropic and ai.
 *
 * Security:
 *   - API key read from env only; never logged.
 *   - Message content never logged; only counts.
 */

// ── Vendor SDK imports (allowed only in packages/agents/src/providers/**) ─────
import { createAnthropic } from '@ai-sdk/anthropic'
import { streamText, type CoreMessage as AiCoreMessage } from 'ai'

import type { StreamProvider, CoreMessage, ToolDefinition, ProviderStreamOptions, ProviderChunk } from './types.js'
import { ProviderError } from './types.js'
import { buildToolSet } from './utils.js'

// ── Pricing table (USD per 1 M tokens) ───────────────────────────────────────

const PRICING: Record<string, { input: number; output: number }> = {
  'claude-opus-4-5': { input: 15.0, output: 75.0 },
  'claude-sonnet-4-5': { input: 3.0, output: 15.0 },
  'claude-sonnet-5': { input: 3.0, output: 15.0 },
  'claude-haiku-4-5': { input: 0.25, output: 1.25 },
}

function estimateUsd(model: string, inputTokens: number, outputTokens: number): number {
  // eslint-disable-next-line security/detect-object-injection
  const pricing = PRICING[model] ?? { input: 3.0, output: 15.0 }
  return (inputTokens * pricing.input + outputTokens * pricing.output) / 1_000_000
}

// ── Provider ──────────────────────────────────────────────────────────────────

export class AnthropicProvider implements StreamProvider {
  readonly name = 'anthropic'

  private getClient(): ReturnType<typeof createAnthropic> {
    const apiKey = process.env['ANTHROPIC_API_KEY']
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY environment variable is required')
    return createAnthropic({ apiKey })
  }

  async *stream(
    model: string,
    messages: CoreMessage[],
    tools: ToolDefinition[],
    opts: ProviderStreamOptions,
  ): AsyncGenerator<ProviderChunk> {
    const client = this.getClient()
    const aiTools = buildToolSet(tools)

    // When promptCaching is enabled, attach Anthropic's ephemeral cache_control
    // to the first message (stable prefix — usually the system message).
    // The Vercel AI SDK surfaces this via experimental_providerMetadata.
    const firstMsg = messages[0]
    const aiMessages: AiCoreMessage[] =
      opts.promptCaching === true && firstMsg !== undefined
        ? [
            {
              ...(firstMsg as AiCoreMessage),
              experimental_providerMetadata: {
                anthropic: { cacheControl: { type: 'ephemeral' } },
              },
            },
            ...(messages.slice(1) as AiCoreMessage[]),
          ]
        : (messages as AiCoreMessage[])

    // Build args step by step so exactOptionalPropertyTypes is satisfied:
    // optional properties are added via spread only when they carry a real value.
    const base = {
      model: client(model),
      messages: aiMessages,
      temperature: opts.temperature,
      maxTokens: opts.maxOutputTokens,
    }
    const withTools = aiTools !== undefined ? { ...base, tools: aiTools } : base
    const callArgs = opts.signal !== undefined ? { ...withTools, abortSignal: opts.signal } : withTools

    // streamText() returns synchronously — errors come through fullStream, not here.
    const result = streamText(callArgs)

    try {
      for await (const chunk of result.fullStream) {
        if (chunk.type === 'reasoning') {
          yield { type: 'thought', text: chunk.textDelta }
        } else if (chunk.type === 'text-delta') {
          yield { type: 'content', text: chunk.textDelta }
        } else if (chunk.type === 'tool-call') {
          yield {
            type: 'tool_call',
            callId: chunk.toolCallId,
            name: chunk.toolName,
            input: chunk.args as unknown,
          }
        } else if (chunk.type === 'finish') {
          const inputTokens = chunk.usage?.promptTokens ?? 0
          const outputTokens = chunk.usage?.completionTokens ?? 0
          yield {
            type: 'usage',
            inputTokens,
            outputTokens,
            estimatedUsd: estimateUsd(model, inputTokens, outputTokens),
          }
        } else if (chunk.type === 'error') {
          const err = chunk.error as { status?: number }
          const status = err?.status
          if (typeof status === 'number' && (status === 429 || status >= 500)) {
            throw new ProviderError(`Anthropic stream error ${status}`, status, this.name)
          }
          throw new Error(`Anthropic stream error: ${String(chunk.error)}`)
        }
      }
    } catch (err: unknown) {
      if (err instanceof ProviderError) throw err
      const status = (err as { status?: number })?.status
      if (typeof status === 'number' && (status === 429 || status >= 500)) {
        throw new ProviderError(`Anthropic error ${status}`, status, this.name)
      }
      throw err
    }
  }
}

export function createAnthropicProvider(): StreamProvider {
  return new AnthropicProvider()
}
