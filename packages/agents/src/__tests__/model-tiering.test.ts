/**
 * Model tiering + OpenRouter reasoning-control tests.
 *
 * - purpose 'delegation' routes to OPENAI_CHAT_MODEL_LIGHT; everything else primary
 * - reasoning:{enabled:false} injected into chat bodies when base URL is OpenRouter
 * - wrapper leaves non-chat bodies (embeddings) untouched
 * - OPENAI_REASONING=on disables the wrapper
 *
 * Env is read at module load, so each test resets modules and stubs env
 * before dynamically importing the provider factory.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockGenerateText, capturedCreateOpenAI } = vi.hoisted(() => ({
  mockGenerateText: vi.fn(),
  capturedCreateOpenAI: { calls: [] as Array<Record<string, unknown>> },
}));

vi.mock('ai', () => ({
  generateText: mockGenerateText,
  streamText: vi.fn(),
  embedMany: vi.fn(),
}));

vi.mock('@ai-sdk/anthropic', () => ({
  createAnthropic: vi.fn(() => vi.fn()),
}));

vi.mock('@ai-sdk/openai', () => ({
  createOpenAI: vi.fn((opts: Record<string, unknown>) => {
    capturedCreateOpenAI.calls.push(opts);
    const modelFn = vi.fn((id: string) => `model-ref:${id}`);
    return Object.assign(modelFn, {
      chat: vi.fn((id: string) => `chat-model-ref:${id}`),
      textEmbeddingModel: vi.fn((id: string) => `embed-model-ref:${id}`),
    });
  }),
}));

async function freshRouter() {
  vi.resetModules();
  capturedCreateOpenAI.calls.length = 0;
  const { createLiveRouter } = await import('../providers/index.js');
  return createLiveRouter(undefined, 'test-key');
}

beforeEach(() => {
  mockGenerateText.mockReset();
  mockGenerateText.mockResolvedValue({ text: 'ok', usage: { inputTokens: 1, outputTokens: 1 } });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('model tiering by purpose', () => {
  it("uses the light model for purpose 'delegation' and primary otherwise", async () => {
    vi.stubEnv('OPENAI_CHAT_MODEL', 'primary-model');
    vi.stubEnv('OPENAI_CHAT_MODEL_LIGHT', 'light-model');

    const router = await freshRouter();

    await router.chat({ projectId: 'p', purpose: 'delegation', messages: [{ role: 'user', content: 'x' }] });
    expect(mockGenerateText.mock.calls[0]?.[0]?.model).toBe('chat-model-ref:light-model');

    await router.chat({ projectId: 'p', purpose: 'turn', messages: [{ role: 'user', content: 'x' }] });
    expect(mockGenerateText.mock.calls[1]?.[0]?.model).toBe('chat-model-ref:primary-model');

    // no purpose given → primary
    await router.chat({ projectId: 'p', messages: [{ role: 'user', content: 'x' }] });
    expect(mockGenerateText.mock.calls[2]?.[0]?.model).toBe('chat-model-ref:primary-model');
  });

  it('falls back to the primary model when the light tier is unset', async () => {
    vi.stubEnv('OPENAI_CHAT_MODEL', 'only-model');
    vi.stubEnv('OPENAI_CHAT_MODEL_LIGHT', '');

    const router = await freshRouter();
    await router.chat({ projectId: 'p', purpose: 'delegation', messages: [{ role: 'user', content: 'x' }] });
    // Empty light list → fall back to the primary model.
    const used = mockGenerateText.mock.calls[0]?.[0]?.model as string;
    expect(used).toBe('chat-model-ref:only-model');
  });
});

describe('MODEL_MAX_TOKENS default', () => {
  it('applies env default when caller passes no maxTokens', async () => {
    vi.stubEnv('MODEL_MAX_TOKENS', '1234');
    const router = await freshRouter();
    await router.chat({ projectId: 'p', messages: [{ role: 'user', content: 'x' }] });
    expect(mockGenerateText.mock.calls[0]?.[0]?.maxOutputTokens).toBe(1234);
  });

  it('caller-provided maxTokens wins over env default', async () => {
    vi.stubEnv('MODEL_MAX_TOKENS', '1234');
    const router = await freshRouter();
    await router.chat({ projectId: 'p', maxTokens: 55, messages: [{ role: 'user', content: 'x' }] });
    expect(mockGenerateText.mock.calls[0]?.[0]?.maxOutputTokens).toBe(55);
  });
});

describe('OpenRouter reasoning control', () => {
  it('passes a custom fetch to createOpenAI when base URL is OpenRouter', async () => {
    vi.stubEnv('OPENAI_BASE_URL', 'https://openrouter.ai/api/v1');
    vi.stubEnv('OPENAI_REASONING', '');
    await freshRouter();
    const chatProviderOpts = capturedCreateOpenAI.calls[0];
    expect(chatProviderOpts?.['fetch']).toBeTypeOf('function');
  });

  it('does NOT wrap fetch for non-OpenRouter base URLs', async () => {
    vi.stubEnv('OPENAI_BASE_URL', 'https://api.openai.com/v1');
    await freshRouter();
    expect(capturedCreateOpenAI.calls[0]?.['fetch']).toBeUndefined();
  });

  it('does NOT wrap fetch when OPENAI_REASONING=on', async () => {
    vi.stubEnv('OPENAI_BASE_URL', 'https://openrouter.ai/api/v1');
    vi.stubEnv('OPENAI_REASONING', 'on');
    await freshRouter();
    expect(capturedCreateOpenAI.calls[0]?.['fetch']).toBeUndefined();
  });

  it('injects reasoning:{enabled:false} into chat bodies and leaves others alone', async () => {
    vi.stubEnv('OPENAI_BASE_URL', 'https://openrouter.ai/api/v1');
    vi.stubEnv('OPENAI_REASONING', '');
    await freshRouter();

    const wrapped = capturedCreateOpenAI.calls[0]?.['fetch'] as typeof fetch;
    const realFetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 200 }));

    // Chat body (has messages) → reasoning injected
    await wrapped('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      body: JSON.stringify({ model: 'm', messages: [{ role: 'user', content: 'x' }] }),
    });
    const chatBody = JSON.parse(realFetch.mock.calls[0]?.[1]?.body as string);
    expect(chatBody.reasoning).toEqual({ enabled: false });

    // Embeddings body (no messages) → untouched
    await wrapped('https://openrouter.ai/api/v1/embeddings', {
      method: 'POST',
      body: JSON.stringify({ model: 'e', input: ['hello'] }),
    });
    const embedBody = JSON.parse(realFetch.mock.calls[1]?.[1]?.body as string);
    expect(embedBody.reasoning).toBeUndefined();

    realFetch.mockRestore();
  });
});
