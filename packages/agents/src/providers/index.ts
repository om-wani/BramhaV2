/**
 * Live provider implementation for ModelRouter.
 *
 * - Primary stream/chat: Anthropic claude-sonnet-4-6, 2 retries (500 ms / 2 s backoff)
 * - Fallback stream/chat: OpenAI gpt-4o-mini
 * - Embeddings: OpenAI text-embedding-3-small, batched ≤ 64
 * - Logging injected via onCallComplete callback (no @bramha/db import — boundaries rule)
 */

import { streamText, generateText, embedMany } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import type {
  ModelRouter,
  ChatParams,
  EmbedParams,
  CallPurpose,
  ModelCallRecord,
  OnCallComplete,
} from '../model-router.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ANTHROPIC_MODEL = 'claude-sonnet-4-6';
const OPENAI_CHAT_MODEL = 'gpt-4o-mini';
const OPENAI_EMBED_MODEL = 'text-embedding-3-small';
const EMBED_BATCH_SIZE = 64;
const RETRY_BACKOFFS_MS: readonly [number, number] = [500, 2000];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type AnthropicProvider = ReturnType<typeof createAnthropic>;
type OpenAIProvider = ReturnType<typeof createOpenAI>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function fireLog(onCallComplete: OnCallComplete | undefined, record: ModelCallRecord): void {
  if (onCallComplete === undefined) return;
  try {
    void Promise.resolve(onCallComplete(record)).catch(() => {
      // swallow logging errors — never break the model call path
    });
  } catch {
    // swallow sync errors too
  }
}

// Build streamText/generateText call args, omitting system when undefined
// (exactOptionalPropertyTypes: true forbids passing undefined to optional fields)
function buildTextOpts<T extends object>(
  base: T,
  system: string | undefined,
): T & { system?: string } {
  if (system !== undefined) {
    return { ...base, system };
  }
  return base;
}

// ---------------------------------------------------------------------------
// Stream with retry + fallback
// ---------------------------------------------------------------------------

async function* streamWithRetryAndLog(
  anthropicProvider: AnthropicProvider,
  openaiProvider: OpenAIProvider | null,
  params: ChatParams,
  onCallComplete: OnCallComplete | undefined,
): AsyncGenerator<string> {
  const {
    projectId,
    roomId,
    persona,
    purpose = 'turn',
    messages,
    system,
    maxTokens = 700,
  } = params;

  let lastErr: unknown;

  // Primary: Anthropic — up to 2 retry attempts
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) {
      await sleep(RETRY_BACKOFFS_MS[attempt - 1] ?? 500);
    }
    try {
      const start = Date.now();
      const callOpts = buildTextOpts(
        { model: anthropicProvider(ANTHROPIC_MODEL), messages, maxOutputTokens: maxTokens },
        system,
      );
      const result = streamText(callOpts);
      for await (const chunk of result.textStream) {
        yield chunk;
      }
      const usage = await result.usage;
      fireLog(onCallComplete, {
        projectId,
        ...(roomId !== undefined ? { roomId } : {}),
        ...(persona !== undefined ? { persona } : {}),
        provider: 'anthropic',
        model: ANTHROPIC_MODEL,
        purpose: purpose as CallPurpose,
        inputTokens: usage.inputTokens ?? 0,
        outputTokens: usage.outputTokens ?? 0,
        latencyMs: Date.now() - start,
      });
      return;
    } catch (err) {
      lastErr = err;
    }
  }

  // Fallback: OpenAI
  if (openaiProvider !== null) {
    try {
      const start = Date.now();
      const callOpts = buildTextOpts(
        { model: openaiProvider(OPENAI_CHAT_MODEL), messages, maxOutputTokens: maxTokens },
        system,
      );
      const result = streamText(callOpts);
      for await (const chunk of result.textStream) {
        yield chunk;
      }
      const usage = await result.usage;
      fireLog(onCallComplete, {
        projectId,
        ...(roomId !== undefined ? { roomId } : {}),
        ...(persona !== undefined ? { persona } : {}),
        provider: 'openai',
        model: OPENAI_CHAT_MODEL,
        purpose: purpose as CallPurpose,
        inputTokens: usage.inputTokens ?? 0,
        outputTokens: usage.outputTokens ?? 0,
        latencyMs: Date.now() - start,
      });
      return;
    } catch (err) {
      lastErr = err;
    }
  }

  throw new Error(
    `ModelRouter: all stream attempts failed. Last error: ${String(lastErr)}`,
  );
}

// ---------------------------------------------------------------------------
// Non-streaming chat with retry + fallback
// ---------------------------------------------------------------------------

async function chatWithRetryAndLog(
  anthropicProvider: AnthropicProvider,
  openaiProvider: OpenAIProvider | null,
  params: ChatParams,
  onCallComplete: OnCallComplete | undefined,
): Promise<string> {
  const {
    projectId,
    roomId,
    persona,
    purpose = 'turn',
    messages,
    system,
    maxTokens = 700,
  } = params;

  let lastErr: unknown;

  // Primary: Anthropic — up to 2 retry attempts
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) {
      await sleep(RETRY_BACKOFFS_MS[attempt - 1] ?? 500);
    }
    try {
      const start = Date.now();
      const callOpts = buildTextOpts(
        { model: anthropicProvider(ANTHROPIC_MODEL), messages, maxOutputTokens: maxTokens },
        system,
      );
      const result = await generateText(callOpts);
      fireLog(onCallComplete, {
        projectId,
        ...(roomId !== undefined ? { roomId } : {}),
        ...(persona !== undefined ? { persona } : {}),
        provider: 'anthropic',
        model: ANTHROPIC_MODEL,
        purpose: purpose as CallPurpose,
        inputTokens: result.usage.inputTokens ?? 0,
        outputTokens: result.usage.outputTokens ?? 0,
        latencyMs: Date.now() - start,
      });
      return result.text;
    } catch (err) {
      lastErr = err;
    }
  }

  // Fallback: OpenAI
  if (openaiProvider !== null) {
    try {
      const start = Date.now();
      const callOpts = buildTextOpts(
        { model: openaiProvider(OPENAI_CHAT_MODEL), messages, maxOutputTokens: maxTokens },
        system,
      );
      const result = await generateText(callOpts);
      fireLog(onCallComplete, {
        projectId,
        ...(roomId !== undefined ? { roomId } : {}),
        ...(persona !== undefined ? { persona } : {}),
        provider: 'openai',
        model: OPENAI_CHAT_MODEL,
        purpose: purpose as CallPurpose,
        inputTokens: result.usage.inputTokens ?? 0,
        outputTokens: result.usage.outputTokens ?? 0,
        latencyMs: Date.now() - start,
      });
      return result.text;
    } catch (err) {
      lastErr = err;
    }
  }

  throw new Error(
    `ModelRouter: all chat attempts failed. Last error: ${String(lastErr)}`,
  );
}

// ---------------------------------------------------------------------------
// Embeddings
// ---------------------------------------------------------------------------

async function embedWithLog(
  openaiProvider: OpenAIProvider,
  params: EmbedParams,
  onCallComplete: OnCallComplete | undefined,
): Promise<number[][]> {
  const { projectId, roomId, inputs } = params;
  const allEmbeddings: number[][] = [];
  const start = Date.now();
  let totalInputTokens = 0;

  // Batch ≤ 64
  for (let i = 0; i < inputs.length; i += EMBED_BATCH_SIZE) {
    const batch = inputs.slice(i, i + EMBED_BATCH_SIZE);
    const result = await embedMany({
      model: openaiProvider.textEmbeddingModel(OPENAI_EMBED_MODEL),
      values: batch,
    });
    allEmbeddings.push(...(result.embeddings as number[][]));
    totalInputTokens += result.usage.tokens ?? batch.length;
  }

  fireLog(onCallComplete, {
    projectId,
    ...(roomId !== undefined ? { roomId } : {}),
    provider: 'openai',
    model: OPENAI_EMBED_MODEL,
    purpose: 'embedding',
    inputTokens: totalInputTokens,
    outputTokens: 0,
    latencyMs: Date.now() - start,
  });

  return allEmbeddings;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createLiveRouter(
  anthropicKey: string | undefined,
  openaiKey: string | undefined,
  onCallComplete?: OnCallComplete,
): ModelRouter {
  const anthropicProvider = anthropicKey !== undefined
    ? createAnthropic({ apiKey: anthropicKey })
    : null;
  const openaiProvider = openaiKey !== undefined
    ? createOpenAI({ apiKey: openaiKey })
    : null;

  return {
    async chat(params: ChatParams): Promise<string> {
      if (anthropicProvider !== null) {
        return chatWithRetryAndLog(anthropicProvider, openaiProvider, params, onCallComplete);
      }
      if (openaiProvider !== null) {
        // OpenAI-only mode
        const start = Date.now();
        const callOpts = buildTextOpts(
          {
            model: openaiProvider(OPENAI_CHAT_MODEL),
            messages: params.messages,
            maxOutputTokens: params.maxTokens ?? 700,
          },
          params.system,
        );
        const result = await generateText(callOpts);
        fireLog(onCallComplete, {
          projectId: params.projectId,
          ...(params.roomId !== undefined ? { roomId: params.roomId } : {}),
          ...(params.persona !== undefined ? { persona: params.persona } : {}),
          provider: 'openai',
          model: OPENAI_CHAT_MODEL,
          purpose: (params.purpose ?? 'turn') as CallPurpose,
          inputTokens: result.usage.inputTokens ?? 0,
          outputTokens: result.usage.outputTokens ?? 0,
          latencyMs: Date.now() - start,
        });
        return result.text;
      }
      throw new Error('ModelRouter: no provider available for chat.');
    },

    async *stream(params: ChatParams): AsyncGenerator<string> {
      if (anthropicProvider !== null) {
        yield* streamWithRetryAndLog(anthropicProvider, openaiProvider, params, onCallComplete);
        return;
      }
      if (openaiProvider !== null) {
        // OpenAI-only mode
        const start = Date.now();
        const callOpts = buildTextOpts(
          {
            model: openaiProvider(OPENAI_CHAT_MODEL),
            messages: params.messages,
            maxOutputTokens: params.maxTokens ?? 700,
          },
          params.system,
        );
        const result = streamText(callOpts);
        for await (const chunk of result.textStream) {
          yield chunk;
        }
        const usage = await result.usage;
        fireLog(onCallComplete, {
          projectId: params.projectId,
          ...(params.roomId !== undefined ? { roomId: params.roomId } : {}),
          ...(params.persona !== undefined ? { persona: params.persona } : {}),
          provider: 'openai',
          model: OPENAI_CHAT_MODEL,
          purpose: (params.purpose ?? 'turn') as CallPurpose,
          inputTokens: usage.inputTokens ?? 0,
          outputTokens: usage.outputTokens ?? 0,
          latencyMs: Date.now() - start,
        });
        return;
      }
      throw new Error('ModelRouter: no provider available for streaming.');
    },

    async embed(params: EmbedParams): Promise<number[][]> {
      if (openaiProvider === null) {
        throw new Error('ModelRouter: OPENAI_API_KEY required for embeddings.');
      }
      return embedWithLog(openaiProvider, params, onCallComplete);
    },
  };
}
