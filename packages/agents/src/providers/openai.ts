/**
 * OpenAI provider — ONLY file allowed to import @ai-sdk/openai.
 *
 * Security:
 *   - API key read from env only; never logged.
 *   - Message content never logged; only counts.
 */

// ── Vendor SDK imports (allowed only in packages/agents/src/providers/**) ─────
import { createOpenAI } from '@ai-sdk/openai'
import { streamText, jsonSchema, type ToolSet, type CoreMessage as AiCoreMessage } from 'ai'

import type { StreamProvider, CoreMessage, ToolDefinition, ProviderStreamOptions, ProviderChunk } from './types.js'
import { ProviderError } from './types.js'

// ── Pricing table (USD per 1 M tokens) ───────────────────────────────────────

const PRICING: Record<string, { input: number; output: number }> = {
  'gpt-4o': { input: 2.5, output: 10.0 },
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  'gpt-4-turbo': { input: 10.0, output: 30.0 },
  'o1-mini': { input: 1.1, output: 4.4 },
  'o1': { input: 15.0, output: 60.0 },
}

function estimateUsd(model: string, inputTokens: number, outputTokens: number): number {
  // eslint-disable-next-line security/detect-object-injection
  const pricing = PRICING[model] ?? { input: 2.5, output: 10.0 }
  return (inputTokens * pricing.input + outputTokens * pricing.output) / 1_000_000
}

// ── Tools builder ─────────────────────────────────────────────────────────────

function buildToolSet(toolDefs: ToolDefinition[]): ToolSet | undefined {
  if (toolDefs.length === 0) return undefined
  return toolDefs.reduce<ToolSet>((acc, t) => {
    const params = jsonSchema(t.parameters as Parameters<typeof jsonSchema>[0])
    if (t.description !== undefined) {
      acc[t.name] = { parameters: params, description: t.description }
    } else {
      acc[t.name] = { parameters: params }
    }
    return acc
  }, {})
}

// ── Provider ──────────────────────────────────────────────────────────────────

export class OpenAIProvider implements StreamProvider {
  readonly name = 'openai'

  private getClient(): ReturnType<typeof createOpenAI> {
    const apiKey = process.env['OPENAI_API_KEY']
    if (!apiKey) throw new Error('OPENAI_API_KEY environment variable is required')
    const baseURL = process.env['OPENAI_BASE_URL']
    return createOpenAI({ apiKey, ...(baseURL !== undefined ? { baseURL } : {}) })
  }

  async *stream(
    model: string,
    messages: CoreMessage[],
    tools: ToolDefinition[],
    opts: ProviderStreamOptions,
  ): AsyncGenerator<ProviderChunk> {
    const client = this.getClient()
    const aiTools = buildToolSet(tools)
    const aiMessages = messages as AiCoreMessage[]

    const base = {
      model: client(model),
      messages: aiMessages,
      temperature: opts.temperature,
      maxTokens: opts.maxOutputTokens,
    }
    const withTools = aiTools !== undefined ? { ...base, tools: aiTools } : base
    const callArgs = opts.signal !== undefined ? { ...withTools, abortSignal: opts.signal } : withTools

    let result
    try {
      result = streamText(callArgs)
    } catch (err: unknown) {
      const status = (err as { status?: number })?.status
      if (typeof status === 'number' && (status === 429 || status >= 500)) {
        throw new ProviderError(`OpenAI error ${status}`, status, this.name)
      }
      throw err
    }

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
            throw new ProviderError(`OpenAI stream error ${status}`, status, this.name)
          }
          throw new Error(`OpenAI stream error: ${String(chunk.error)}`)
        }
      }
    } catch (err: unknown) {
      if (err instanceof ProviderError) throw err
      const status = (err as { status?: number })?.status
      if (typeof status === 'number' && (status === 429 || status >= 500)) {
        throw new ProviderError(`OpenAI error ${status}`, status, this.name)
      }
      throw err
    }
  }
}

export function createOpenAIProvider(): StreamProvider {
  return new OpenAIProvider()
}
