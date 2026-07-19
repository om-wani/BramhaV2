/**
 * ModelRouter tests — all API calls are mocked; logging verified via onCallComplete callback.
 *
 * Tests:
 * 1. Primary (Anthropic) success: full response, fires onCallComplete with correct record
 * 2. Primary fails first attempt, succeeds on second retry
 * 3. Primary fails both attempts, fallback (OpenAI) succeeds
 * 4. embed() returns correct shape (array of float arrays) and fires onCallComplete
 * 5. stream() yields tokens in order and fires onCallComplete on completion
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoist mock variables so they are available when vi.mock factories run
// ---------------------------------------------------------------------------
const {
  mockGenerateText,
  mockStreamText,
  mockEmbedMany,
  mockAnthropicModel,
  mockOpenAIModel,
  mockTextEmbeddingModel,
} = vi.hoisted(() => {
  const mockGenerateText = vi.fn();
  const mockStreamText = vi.fn();
  const mockEmbedMany = vi.fn();
  const mockAnthropicModel = vi.fn().mockReturnValue('anthropic-model-ref');
  const mockTextEmbeddingModel = vi.fn().mockReturnValue('openai-embed-model-ref');
  const mockOpenAIModel = vi.fn().mockReturnValue('openai-model-ref');
  return {
    mockGenerateText,
    mockStreamText,
    mockEmbedMany,
    mockAnthropicModel,
    mockOpenAIModel,
    mockTextEmbeddingModel,
  };
});

// ---------------------------------------------------------------------------
// Mock ai SDK functions
// ---------------------------------------------------------------------------
vi.mock('ai', () => ({
  generateText: mockGenerateText,
  streamText: mockStreamText,
  embedMany: mockEmbedMany,
}));

// ---------------------------------------------------------------------------
// Mock @ai-sdk/anthropic and @ai-sdk/openai
// ---------------------------------------------------------------------------
vi.mock('@ai-sdk/anthropic', () => ({
  createAnthropic: vi.fn(() => mockAnthropicModel),
}));

vi.mock('@ai-sdk/openai', () => ({
  createOpenAI: vi.fn(() => {
    const fn = Object.assign(mockOpenAIModel, {
      textEmbeddingModel: mockTextEmbeddingModel,
    });
    return fn;
  }),
}));

// ---------------------------------------------------------------------------
// Import the module under test (after mocks are set up)
// ---------------------------------------------------------------------------
import { createLiveRouter } from '../providers/index.js';
import type { ModelCallRecord } from '../model-router.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRouter(
  anthropicKey = 'ant-key',
  openaiKey = 'oai-key',
  onCallComplete?: (r: ModelCallRecord) => void,
) {
  return createLiveRouter(anthropicKey, openaiKey, onCallComplete);
}

function makeAsyncIterable(chunks: string[]): AsyncIterable<string> {
  return {
    [Symbol.asyncIterator]() {
      let i = 0;
      return {
        async next() {
          if (i < chunks.length) {
            return { value: chunks[i++]!, done: false as const };
          }
          return { value: undefined as unknown as string, done: true as const };
        },
      };
    },
  };
}

function makeStreamResult(chunks: string[], inputTokens = 10, outputTokens = 20) {
  return {
    textStream: makeAsyncIterable(chunks),
    usage: Promise.resolve({ inputTokens, outputTokens }),
  };
}

function makeFailingStream(message: string) {
  return {
    textStream: {
      [Symbol.asyncIterator]() {
        return {
          next(): Promise<never> {
            return Promise.reject(new Error(message));
          },
        };
      },
    },
    usage: Promise.resolve({ inputTokens: 0, outputTokens: 0 }),
  };
}

// ---------------------------------------------------------------------------
// Reset mocks before each test
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  // Re-attach textEmbeddingModel after clearAllMocks resets it
  Object.assign(mockOpenAIModel, { textEmbeddingModel: mockTextEmbeddingModel });
});

// ---- chat() ----------------------------------------------------------------

describe('ModelRouter.chat()', () => {
  it('primary success: returns text and fires onCallComplete with anthropic record', async () => {
    mockGenerateText.mockResolvedValueOnce({
      text: 'Hello from Anthropic',
      usage: { inputTokens: 100, outputTokens: 50 },
    });

    const onCallComplete = vi.fn();
    const router = makeRouter('ant-key', 'oai-key', onCallComplete);
    const text = await router.chat({
      projectId: 'proj-1',
      messages: [{ role: 'user', content: 'Hello' }],
    });

    expect(text).toBe('Hello from Anthropic');
    expect(mockGenerateText).toHaveBeenCalledTimes(1);

    const callArgs = mockGenerateText.mock.calls[0]?.[0];
    expect(callArgs.model).toBe('anthropic-model-ref');

    // Wait for async logging
    await vi.waitFor(() => expect(onCallComplete).toHaveBeenCalledTimes(1));
    const record: ModelCallRecord = onCallComplete.mock.calls[0]?.[0];
    expect(record).toMatchObject({
      projectId: 'proj-1',
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      purpose: 'turn',
      inputTokens: 100,
      outputTokens: 50,
    });
    expect(typeof record.latencyMs).toBe('number');
  });

  it('primary fails first attempt, succeeds on second retry', async () => {
    mockGenerateText
      .mockRejectedValueOnce(new Error('Rate limited'))
      .mockResolvedValueOnce({
        text: 'Retry success',
        usage: { inputTokens: 80, outputTokens: 30 },
      });

    const onCallComplete = vi.fn();
    const router = makeRouter('ant-key', 'oai-key', onCallComplete);
    const text = await router.chat({
      projectId: 'proj-2',
      messages: [{ role: 'user', content: 'Retry me' }],
    });

    expect(text).toBe('Retry success');
    expect(mockGenerateText).toHaveBeenCalledTimes(2);
    // Both calls used anthropic model
    for (const call of mockGenerateText.mock.calls) {
      expect(call[0].model).toBe('anthropic-model-ref');
    }
    // One record fired (on success)
    await vi.waitFor(() => expect(onCallComplete).toHaveBeenCalledTimes(1));
    const record: ModelCallRecord = onCallComplete.mock.calls[0]?.[0];
    expect(record.provider).toBe('anthropic');
  });

  it('primary fails twice, fallback (OpenAI) succeeds and fires openai record', async () => {
    mockGenerateText
      .mockRejectedValueOnce(new Error('fail 1'))
      .mockRejectedValueOnce(new Error('fail 2'))
      .mockResolvedValueOnce({
        text: 'Fallback response',
        usage: { inputTokens: 60, outputTokens: 25 },
      });

    const onCallComplete = vi.fn();
    const router = makeRouter('ant-key', 'oai-key', onCallComplete);
    const text = await router.chat({
      projectId: 'proj-3',
      messages: [{ role: 'user', content: 'Need fallback' }],
    });

    expect(text).toBe('Fallback response');
    expect(mockGenerateText).toHaveBeenCalledTimes(3);
    // Third call uses openai model
    expect(mockGenerateText.mock.calls[2]?.[0].model).toBe('openai-model-ref');

    await vi.waitFor(() => expect(onCallComplete).toHaveBeenCalledTimes(1));
    const record: ModelCallRecord = onCallComplete.mock.calls[0]?.[0];
    expect(record.provider).toBe('openai');
    expect(record.model).toBe('gpt-4o-mini');
  });

  it('throws when all providers fail', async () => {
    mockGenerateText
      .mockRejectedValueOnce(new Error('anthropic fail 1'))
      .mockRejectedValueOnce(new Error('anthropic fail 2'))
      .mockRejectedValueOnce(new Error('openai fail'));

    const router = makeRouter();
    await expect(
      router.chat({
        projectId: 'proj-4',
        messages: [{ role: 'user', content: 'doom' }],
      }),
    ).rejects.toThrow('ModelRouter: all chat attempts failed');
  });

  it('passes maxOutputTokens, system, and purpose to provider', async () => {
    mockGenerateText.mockResolvedValueOnce({
      text: 'ok',
      usage: { inputTokens: 5, outputTokens: 2 },
    });

    const onCallComplete = vi.fn();
    const router = makeRouter('ant-key', 'oai-key', onCallComplete);
    await router.chat({
      projectId: 'proj-5',
      persona: 'ceo',
      purpose: 'delegation',
      messages: [{ role: 'user', content: 'hi' }],
      system: 'You are helpful.',
      maxTokens: 300,
    });

    const callArgs = mockGenerateText.mock.calls[0]?.[0];
    expect(callArgs.system).toBe('You are helpful.');
    expect(callArgs.maxOutputTokens).toBe(300);

    await vi.waitFor(() => expect(onCallComplete).toHaveBeenCalledTimes(1));
    const record: ModelCallRecord = onCallComplete.mock.calls[0]?.[0];
    expect(record.persona).toBe('ceo');
    expect(record.purpose).toBe('delegation');
  });
});

// ---- stream() --------------------------------------------------------------

describe('ModelRouter.stream()', () => {
  it('primary success: yields tokens and fires onCallComplete on completion', async () => {
    const chunks = ['Hello', ' world', '!'];
    mockStreamText.mockReturnValueOnce(makeStreamResult(chunks, 20, 10));

    const onCallComplete = vi.fn();
    const router = makeRouter('ant-key', 'oai-key', onCallComplete);
    const received: string[] = [];
    for await (const delta of router.stream({
      projectId: 'proj-s1',
      messages: [{ role: 'user', content: 'Stream me' }],
    })) {
      received.push(delta);
    }

    expect(received).toEqual(chunks);

    await vi.waitFor(() => expect(onCallComplete).toHaveBeenCalledTimes(1));
    const record: ModelCallRecord = onCallComplete.mock.calls[0]?.[0];
    expect(record.provider).toBe('anthropic');
    expect(record.outputTokens).toBe(10);
  });

  it('primary stream fails twice, fallback stream succeeds', async () => {
    mockStreamText
      .mockReturnValueOnce(makeFailingStream('stream fail 1'))
      .mockReturnValueOnce(makeFailingStream('stream fail 2'))
      .mockReturnValueOnce(makeStreamResult(['fallback chunk'], 15, 5));

    const onCallComplete = vi.fn();
    const router = makeRouter('ant-key', 'oai-key', onCallComplete);
    const received: string[] = [];
    for await (const delta of router.stream({
      projectId: 'proj-s2',
      messages: [{ role: 'user', content: 'fallback stream' }],
    })) {
      received.push(delta);
    }

    expect(received).toEqual(['fallback chunk']);
    await vi.waitFor(() => expect(onCallComplete).toHaveBeenCalledTimes(1));
    const record: ModelCallRecord = onCallComplete.mock.calls[0]?.[0];
    expect(record.provider).toBe('openai');
  });
});

// ---- embed() ---------------------------------------------------------------

describe('ModelRouter.embed()', () => {
  it('returns array of float arrays matching input count', async () => {
    const fakeEmbeddings = [
      [0.1, 0.2, 0.3],
      [0.4, 0.5, 0.6],
    ];
    mockEmbedMany.mockResolvedValueOnce({
      embeddings: fakeEmbeddings,
      usage: { tokens: 12 },
    });

    const router = makeRouter();
    const result = await router.embed({
      projectId: 'proj-e1',
      inputs: ['hello', 'world'],
    });

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual([0.1, 0.2, 0.3]);
    expect(result[1]).toEqual([0.4, 0.5, 0.6]);
  });

  it('fires onCallComplete with purpose=embedding and outputTokens=0', async () => {
    mockEmbedMany.mockResolvedValueOnce({
      embeddings: [[0.1]],
      usage: { tokens: 5 },
    });

    const onCallComplete = vi.fn();
    const router = makeRouter('ant-key', 'oai-key', onCallComplete);
    await router.embed({
      projectId: 'proj-e2',
      inputs: ['one text'],
    });

    await vi.waitFor(() => expect(onCallComplete).toHaveBeenCalledTimes(1));
    const record: ModelCallRecord = onCallComplete.mock.calls[0]?.[0];
    expect(record).toMatchObject({
      projectId: 'proj-e2',
      provider: 'openai',
      model: 'text-embedding-3-small',
      purpose: 'embedding',
      outputTokens: 0,
    });
  });

  it('batches inputs into chunks of ≤ 64', async () => {
    const inputs = Array.from({ length: 70 }, (_, i) => `text ${i}`);
    const batch1 = Array.from({ length: 64 }, (_, i) => [i * 0.01]);
    const batch2 = Array.from({ length: 6 }, (_, i) => [(64 + i) * 0.01]);

    mockEmbedMany
      .mockResolvedValueOnce({ embeddings: batch1, usage: { tokens: 64 } })
      .mockResolvedValueOnce({ embeddings: batch2, usage: { tokens: 6 } });

    const router = makeRouter();
    const result = await router.embed({ projectId: 'proj-e3', inputs });

    expect(mockEmbedMany).toHaveBeenCalledTimes(2);
    expect((mockEmbedMany.mock.calls[0]?.[0] as { values: unknown[] }).values).toHaveLength(64);
    expect((mockEmbedMany.mock.calls[1]?.[0] as { values: unknown[] }).values).toHaveLength(6);
    expect(result).toHaveLength(70);
  });

  it('throws when OPENAI_API_KEY is not configured', async () => {
    const router = createLiveRouter('ant-key', undefined);
    await expect(
      router.embed({ projectId: 'proj-e4', inputs: ['test'] }),
    ).rejects.toThrow('OPENAI_API_KEY required for embeddings');
  });
});
