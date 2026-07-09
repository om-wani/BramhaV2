/**
 * Ollama provider — uses OpenAI-compatible API via @ai-sdk/openai.
 *
 * Ollama exposes an OpenAI-compatible REST API at /v1. We reuse the
 * OpenAI adapter with a custom baseURL pointing to the local Ollama daemon.
 *
 * No API key required; uses 'ollama' as a placeholder to satisfy the SDK.
 */

// ── Vendor SDK imports (allowed only in packages/agents/src/providers/**) ─────
import { createOpenAI } from '@ai-sdk/openai'
import { streamText, type CoreMessage as AiCoreMessage } from 'ai'

import type { StreamProvider, CoreMessage, ToolDefinition, ProviderStreamOptions, ProviderChunk } from './types.js'
import { ProviderError } from './types.js'
import { buildToolSet } from './utils.js'

// ── Provider ──────────────────────────────────────────────────────────────────

export class OllamaProvider implements StreamProvider {
  readonly name = 'ollama'

  private getClient(): ReturnType<typeof createOpenAI> {
    const baseURL = process.env['OLLAMA_BASE_URL'] ?? 'http://localhost:11434/v1'
    // Ollama doesn't require a real API key; 'ollama' is a placeholder
    return createOpenAI({ apiKey: 'ollama', baseURL })
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
          // Ollama is local — estimated cost is $0 but we track tokens for diagnostics
          yield { type: 'usage', inputTokens, outputTokens, estimatedUsd: 0 }
        } else if (chunk.type === 'error') {
          const err = chunk.error as { status?: number }
          const status = err?.status
          if (typeof status === 'number' && (status === 429 || status >= 500)) {
            throw new ProviderError(`Ollama stream error ${status}`, status, this.name)
          }
          throw new Error(`Ollama stream error: ${String(chunk.error)}`)
        }
      }
    } catch (err: unknown) {
      if (err instanceof ProviderError) throw err
      const status = (err as { status?: number })?.status
      if (typeof status === 'number' && (status === 429 || status >= 500)) {
        throw new ProviderError(`Ollama error ${status}`, status, this.name)
      }
      throw err
    }
  }
}

export function createOllamaProvider(): StreamProvider {
  return new OllamaProvider()
}
