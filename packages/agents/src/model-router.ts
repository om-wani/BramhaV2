/**
 * ModelRouter — primary LLM routing with retry + fallback, streaming,
 * embed batching, and model_calls logging.
 *
 * Primary:  Anthropic claude-sonnet-4-6 (via @ai-sdk/anthropic)
 * Fallback: OpenAI gpt-4o-mini         (via @ai-sdk/openai)
 * Embeds:   OpenAI text-embedding-3-small, batched ≤ 64
 *
 * DB logging is injected via the `onCallComplete` hook so this package
 * stays free of @bramha/db (boundaries rule: pkg-agents → pkg-shared only).
 * The server wires in the actual insert; the hook is fire-and-forget.
 */

import { createLiveRouter } from './providers/index.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export type CallPurpose = 'turn' | 'delegation' | 'embedding' | 'proactive';

/** Payload emitted after every model call for logging. */
export interface ModelCallRecord {
  projectId: string;
  roomId?: string;
  userId?: string; // triggering user (null for system/proactive turns)
  persona?: string;
  provider: 'anthropic' | 'openai';
  model: string;
  purpose: CallPurpose;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
}

/** Injected once at bootstrap. Fire-and-forget; never throws into the model path. */
export type OnCallComplete = (record: ModelCallRecord) => void | Promise<void>;

export interface ChatParams {
  projectId: string;
  roomId?: string;
  userId?: string;
  persona?: string;
  purpose?: CallPurpose;
  messages: ChatMessage[];
  system?: string;
  maxTokens?: number;
}

export interface EmbedParams {
  projectId: string;
  roomId?: string;
  userId?: string;
  inputs: string[];
}

export interface ModelRouter {
  /**
   * Non-streaming full response. Fires onCallComplete on completion.
   */
  chat(params: ChatParams): Promise<string>;

  /**
   * Streaming: async generator of text deltas.
   * Fires onCallComplete after the stream is fully consumed.
   */
  stream(params: ChatParams): AsyncGenerator<string>;

  /**
   * Batch embeddings. Batches ≤ 64 per API call. Fires onCallComplete once.
   */
  embed(params: EmbedParams): Promise<number[][]>;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

function createStubRouter(): ModelRouter {
  const throwNoKeys = (): never => {
    throw new Error(
      'ModelRouter: no API keys configured. Set ANTHROPIC_API_KEY or OPENAI_API_KEY.',
    );
  };

  return {
    chat(): Promise<string> {
      return throwNoKeys();
    },
    // eslint-disable-next-line require-yield
    async *stream(): AsyncGenerator<string> {
      return throwNoKeys();
    },
    embed(): Promise<number[][]> {
      return throwNoKeys();
    },
  };
}

export function createModelRouter(onCallComplete?: OnCallComplete): ModelRouter {
  const anthropicKey = process.env['ANTHROPIC_API_KEY'];
  const openaiKey = process.env['OPENAI_API_KEY'];

  if (!anthropicKey && !openaiKey) {
    return createStubRouter();
  }

  return createLiveRouter(anthropicKey, openaiKey, onCallComplete);
}

/** Singleton — caller should invoke configureModelRouter() to inject logging. */
let _modelRouter: ModelRouter = createModelRouter();

/**
 * Wire in the model_calls logger. Call once at server bootstrap before any
 * agent turn fires. Replaces the singleton with a logging-enabled instance.
 */
export function configureModelRouter(onCallComplete: OnCallComplete): void {
  _modelRouter = createModelRouter(onCallComplete);
}

export function getModelRouter(): ModelRouter {
  return _modelRouter;
}

