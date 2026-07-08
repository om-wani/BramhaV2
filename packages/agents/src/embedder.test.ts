/**
 * EmbeddingProvider unit tests (mocked fetch).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { OpenAIEmbeddingProvider } from './embedder.js'

// ── Setup ─────────────────────────────────────────────────────────────────────

const MOCK_API_KEY = 'sk-test-key-that-is-not-real'
const MOCK_DIM = 1536

function makeEmbeddingVector(dim = MOCK_DIM): number[] {
  return Array.from({ length: dim }, (_, i) => i / dim)
}

function makeOpenAIResponse(count: number, dim = MOCK_DIM) {
  return {
    data: Array.from({ length: count }, (_, i) => ({
      embedding: makeEmbeddingVector(dim),
      index: i,
    })),
    usage: { prompt_tokens: count * 10, total_tokens: count * 10 },
  }
}

function makeMockFetch(responses: Array<{ status: number; body?: unknown }>) {
  let callIndex = 0
  return vi.fn(async () => {
    // eslint-disable-next-line security/detect-object-injection
    const response = responses[callIndex] ?? responses[responses.length - 1]!
    callIndex++
    return {
      ok: (response.status ?? 200) < 400,
      status: response.status ?? 200,
      json: async () => response.body,
    } as unknown as Response
  })
}

describe('OpenAIEmbeddingProvider', () => {
  let originalEnv: NodeJS.ProcessEnv

  beforeEach(() => {
    originalEnv = { ...process.env }
    process.env['OPENAI_API_KEY'] = MOCK_API_KEY
    process.env['EMBEDDING_MODEL'] = 'text-embedding-3-small'
    process.env['EMBEDDING_DIM'] = String(MOCK_DIM)
    // Unset Ollama so OpenAI is selected
    delete process.env['OLLAMA_EMBEDDING_MODEL']
  })

  afterEach(() => {
    process.env = originalEnv
    vi.restoreAllMocks()
  })

  it('batches 150 texts into 2 API calls (batch limit is 100)', async () => {
    const texts = Array.from({ length: 150 }, (_, i) => `short text ${i}`)

    const firstBatchResponse = makeOpenAIResponse(100)
    const secondBatchResponse = makeOpenAIResponse(50)

    const mockFetch = makeMockFetch([
      { status: 200, body: firstBatchResponse },
      { status: 200, body: secondBatchResponse },
    ])
    vi.stubGlobal('fetch', mockFetch)

    const provider = new OpenAIEmbeddingProvider()
    const embeddings = await provider.embed(texts)

    expect(mockFetch).toHaveBeenCalledTimes(2)
    expect(embeddings).toHaveLength(150)
    for (const emb of embeddings) {
      expect(emb).toHaveLength(MOCK_DIM)
    }
  })

  it('retries on 429 (2 failures then success)', async () => {
    const texts = ['hello world']

    const mockFetch = makeMockFetch([
      { status: 429 },
      { status: 429 },
      { status: 200, body: makeOpenAIResponse(1) },
    ])
    vi.stubGlobal('fetch', mockFetch)

    // Patch sleep to avoid waiting in tests
    vi.spyOn(globalThis, 'setTimeout').mockImplementation((fn) => {
      fn()
      return 0 as unknown as ReturnType<typeof setTimeout>
    })

    const provider = new OpenAIEmbeddingProvider()
    const embeddings = await provider.embed(texts)

    expect(mockFetch).toHaveBeenCalledTimes(3)
    expect(embeddings).toHaveLength(1)
  })

  it('splits batch when estimated tokens exceed 8000', async () => {
    // Create texts where each is ~100 tokens (400 chars), 90 of them = ~9000 tokens total
    const texts = Array.from({ length: 90 }, () => 'a'.repeat(400))

    // Each text: 400 chars / 4 = 100 tokens
    // 90 texts × 100 tokens = 9000 tokens → exceeds 8000 → should be split into 2 batches

    const mockFetch = makeMockFetch([
      { status: 200, body: makeOpenAIResponse(80) },
      { status: 200, body: makeOpenAIResponse(10) },
    ])
    vi.stubGlobal('fetch', mockFetch)

    const provider = new OpenAIEmbeddingProvider()
    const embeddings = await provider.embed(texts)

    expect(mockFetch).toHaveBeenCalledTimes(2)
    expect(embeddings).toHaveLength(90)
  })

  it('never logs text content (API key and text are not in log output)', async () => {
    const sensitiveText = 'TOP SECRET INTERNAL DOCUMENT CONTENT'
    const texts = [sensitiveText]

    const mockFetch = makeMockFetch([{ status: 200, body: makeOpenAIResponse(1) }])
    vi.stubGlobal('fetch', mockFetch)

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    const provider = new OpenAIEmbeddingProvider()
    await provider.embed(texts)

    // Check that text content was never logged
    const allLogArgs = [
      ...consoleSpy.mock.calls.flat(),
      ...errorSpy.mock.calls.flat(),
    ].map((arg) => String(arg))

    for (const logEntry of allLogArgs) {
      expect(logEntry).not.toContain(sensitiveText)
      expect(logEntry).not.toContain(MOCK_API_KEY)
    }

    // Verify fetch was called (the text is in the request body but not logged)
    expect(mockFetch).toHaveBeenCalled()
  })

  it('throws after 3 failed attempts on persistent 500 errors', async () => {
    const texts = ['hello']

    const mockFetch = makeMockFetch([
      { status: 500 },
      { status: 500 },
      { status: 500 },
    ])
    vi.stubGlobal('fetch', mockFetch)

    vi.spyOn(globalThis, 'setTimeout').mockImplementation((fn) => {
      fn()
      return 0 as unknown as ReturnType<typeof setTimeout>
    })

    const provider = new OpenAIEmbeddingProvider()
    await expect(provider.embed(texts)).rejects.toThrow('after 3 attempts')
  })
})
