import { streamText, embedMany } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import type { ChatRequest, TextDelta, ModelRouter } from '../model-router.js';

type AnthropicProvider = ReturnType<typeof createAnthropic>;
type OpenAIProvider = ReturnType<typeof createOpenAI>;

function buildCallOpts(
  model: Parameters<typeof streamText>[0]['model'],
  req: ChatRequest,
): Parameters<typeof streamText>[0] {
  const opts: Parameters<typeof streamText>[0] = { model, messages: req.messages };
  if (req.maxOutputTokens !== undefined) opts.maxOutputTokens = req.maxOutputTokens;
  if (req.temperature !== undefined) opts.temperature = req.temperature;
  return opts;
}

// Stream from a provider, retrying at the iteration level so real API errors
// (auth, rate-limit, network) are caught — streamText() is lazy; errors surface
// during `for await`, not at call time.
async function* streamWithRetry(
  anthropicProvider: AnthropicProvider,
  openaiProvider: OpenAIProvider | null,
  req: ChatRequest,
): AsyncIterable<TextDelta> {
  let lastErr: unknown;

  // Primary: Anthropic, up to 2 attempts with 500ms backoff
  for (let attempt = 1; attempt <= 2; attempt++) {
    if (attempt > 1) await new Promise<void>((r) => setTimeout(r, 500));
    try {
      const result = streamText(buildCallOpts(anthropicProvider('claude-sonnet-4-6'), req));
      for await (const chunk of result.textStream) {
        yield { text: chunk };
      }
      return; // success
    } catch (err) {
      lastErr = err;
    }
  }

  // Fallback: OpenAI
  if (openaiProvider !== null) {
    try {
      const result = streamText(buildCallOpts(openaiProvider('gpt-4o-mini'), req));
      for await (const chunk of result.textStream) {
        yield { text: chunk };
      }
      return;
    } catch (err) {
      lastErr = err;
    }
  }

  throw new Error(
    `ModelRouter: all stream attempts failed. Last error: ${String(lastErr)}`,
  );
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
      if (anthropicProvider !== null) {
        return streamWithRetry(anthropicProvider, openaiProvider, req);
      }
      if (openaiProvider !== null) {
        // OpenAI-only mode (no Anthropic key)
        return (async function* () {
          const result = streamText(buildCallOpts(openaiProvider('gpt-4o-mini'), req));
          for await (const chunk of result.textStream) {
            yield { text: chunk };
          }
        })();
      }
      throw new Error('ModelRouter: no provider available for streaming.');
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
