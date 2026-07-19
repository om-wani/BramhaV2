import { streamText, embedMany } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import type { ChatRequest, TextDelta, ModelRouter } from '../model-router.js';

type AnthropicProvider = ReturnType<typeof createAnthropic>;
type OpenAIProvider = ReturnType<typeof createOpenAI>;

function toModelMessages(
  req: ChatRequest,
): { role: 'system' | 'user' | 'assistant'; content: string }[] {
  return req.messages.map((m) => ({ role: m.role, content: m.content }));
}

async function anthropicStream(
  provider: AnthropicProvider,
  req: ChatRequest,
  attempt: number,
): Promise<AsyncIterable<TextDelta>> {
  if (attempt > 1) {
    await new Promise<void>((resolve) => setTimeout(resolve, 500));
  }
  const callOpts: Parameters<typeof streamText>[0] = {
    model: provider('claude-sonnet-4-6'),
    messages: toModelMessages(req),
  };
  if (req.maxOutputTokens !== undefined) {
    callOpts.maxOutputTokens = req.maxOutputTokens;
  }
  if (req.temperature !== undefined) {
    callOpts.temperature = req.temperature;
  }
  const result = streamText(callOpts);
  return (async function* (): AsyncIterable<TextDelta> {
    for await (const chunk of result.textStream) {
      yield { text: chunk };
    }
  })();
}

async function openaiStream(
  provider: OpenAIProvider,
  req: ChatRequest,
): Promise<AsyncIterable<TextDelta>> {
  const callOpts: Parameters<typeof streamText>[0] = {
    model: provider('gpt-4o-mini'),
    messages: toModelMessages(req),
  };
  if (req.maxOutputTokens !== undefined) {
    callOpts.maxOutputTokens = req.maxOutputTokens;
  }
  if (req.temperature !== undefined) {
    callOpts.temperature = req.temperature;
  }
  const result = streamText(callOpts);
  return (async function* (): AsyncIterable<TextDelta> {
    for await (const chunk of result.textStream) {
      yield { text: chunk };
    }
  })();
}

async function resolveStream(
  anthropicProvider: AnthropicProvider | null,
  openaiProvider: OpenAIProvider | null,
  req: ChatRequest,
): Promise<AsyncIterable<TextDelta>> {
  if (anthropicProvider !== null) {
    try {
      return await anthropicStream(anthropicProvider, req, 1);
    } catch {
      try {
        return await anthropicStream(anthropicProvider, req, 2);
      } catch {
        if (openaiProvider === null) {
          throw new Error('Anthropic stream failed (both attempts) and no OpenAI fallback configured.');
        }
      }
    }
  }
  if (openaiProvider !== null) {
    return openaiStream(openaiProvider, req);
  }
  throw new Error('ModelRouter: no provider available for streaming.');
}

export function createLiveRouter(
  anthropicKey: string | undefined,
  openaiKey: string | undefined,
): ModelRouter {
  const anthropicProvider = anthropicKey !== undefined
    ? createAnthropic({ apiKey: anthropicKey })
    : null;
  const openaiProvider = openaiKey !== undefined
    ? createOpenAI({ apiKey: openaiKey })
    : null;

  return {
    stream(req: ChatRequest): AsyncIterable<TextDelta> {
      return {
        [Symbol.asyncIterator](): AsyncIterator<TextDelta> {
          let inner: AsyncIterator<TextDelta> | null = null;
          let pending: Promise<AsyncIterable<TextDelta>> | null = null;

          const ensureInner = async (): Promise<AsyncIterator<TextDelta>> => {
            if (inner !== null) return inner;
            if (pending === null) {
              pending = resolveStream(anthropicProvider, openaiProvider, req);
            }
            const iterable = await pending;
            inner = iterable[Symbol.asyncIterator]();
            return inner;
          };

          return {
            async next(): Promise<IteratorResult<TextDelta>> {
              return (await ensureInner()).next();
            },
            async return(value?: unknown): Promise<IteratorResult<TextDelta>> {
              if (inner?.return !== undefined) {
                return inner.return(value) as Promise<IteratorResult<TextDelta>>;
              }
              return { done: true, value: undefined as unknown as TextDelta };
            },
          };
        },
      };
    },

    async embed(texts: string[]): Promise<number[][]> {
      if (openaiProvider === null) {
        throw new Error('ModelRouter: OPENAI_API_KEY required for embeddings.');
      }
      const result = await embedMany({
        model: openaiProvider.textEmbeddingModel('text-embedding-3-small'),
        values: texts,
      });
      return result.embeddings as number[][];
    },
  };
}
