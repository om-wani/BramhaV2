import { createLiveRouter } from './providers/index.js';

export interface TextDelta {
  text: string;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  messages: ChatMessage[];
  maxOutputTokens?: number;
  temperature?: number;
}

export interface ModelRouter {
  stream(req: ChatRequest): AsyncIterable<TextDelta>;
  embed(texts: string[]): Promise<number[][]>;
}

function createStubRouter(): ModelRouter {
  return {
    stream(): AsyncIterable<TextDelta> {
      throw new Error(
        'ModelRouter: no API keys configured. Set ANTHROPIC_API_KEY or OPENAI_API_KEY.',
      );
    },
    embed(): Promise<number[][]> {
      throw new Error(
        'ModelRouter: no API keys configured. Set ANTHROPIC_API_KEY or OPENAI_API_KEY.',
      );
    },
  };
}

export function createModelRouter(): ModelRouter {
  const anthropicKey = process.env['ANTHROPIC_API_KEY'];
  const openaiKey = process.env['OPENAI_API_KEY'];

  if (!anthropicKey && !openaiKey) {
    return createStubRouter();
  }

  return createLiveRouter(anthropicKey, openaiKey);
}
