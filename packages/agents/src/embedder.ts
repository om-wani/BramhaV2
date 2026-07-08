/**
 * Embedding provider abstraction — first ModelRouter slice.
 *
 * Supports OpenAI-compatible APIs and Ollama local models.
 * Full ModelRouter (routing, persona dispatch, etc.) comes in T3.1.1.
 *
 * Security:
 *   - API key read from env only, never logged or included in payloads.
 *   - Text content is never logged; only counts and IDs.
 */

// ── Interfaces ────────────────────────────────────────────────────────────────

export interface EmbeddingProvider {
  /** Embed a batch of texts; returns parallel array of embedding vectors. */
  embed(texts: string[]): Promise<number[][]>
  /** Dimensionality of the embedding vectors produced by this provider. */
  dimension: number
  /** Human-readable model name for logging. */
  model: string
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Exponential-backoff sleep.
 * Caps at 30 s so callers don't wait forever on persistent failures.
 */
function backoffMs(attempt: number): number {
  return Math.min(1_000 * Math.pow(2, attempt), 30_000)
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ── OpenAI provider ───────────────────────────────────────────────────────────

interface OpenAIEmbeddingResponse {
  data: Array<{ embedding: number[]; index: number }>
  usage?: { prompt_tokens?: number; total_tokens?: number }
}

export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  readonly model: string
  readonly dimension: number

  private readonly apiKey: string
  private readonly baseUrl: string
  /** Max texts per API call */
  private readonly batchSize = 100
  /**
   * Max estimated tokens per batch (conservative: 4 chars/token).
   * text-embedding-3-small supports 8191 tokens per input, but batching
   * is per-request so we cap the total batch.
   */
  private readonly maxTokensPerBatch = 8_000

  constructor() {
    const apiKey = process.env['OPENAI_API_KEY']
    if (!apiKey) throw new Error('OPENAI_API_KEY environment variable is required')
    this.apiKey = apiKey
    this.model = process.env['EMBEDDING_MODEL'] ?? 'text-embedding-3-small'
    this.dimension = parseInt(process.env['EMBEDDING_DIM'] ?? '1536', 10)
    this.baseUrl = process.env['OPENAI_BASE_URL'] ?? 'https://api.openai.com'
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return []

    // Split into batches respecting both size and token limits
    const batches = this.buildBatches(texts)
    const results: number[][] = new Array(texts.length)

    let offset = 0
    for (const batch of batches) {
      const embeddings = await this.embedBatch(batch)
      embeddings.forEach((emb, i) => {
        results[offset + i] = emb
      })
      offset += batch.length
    }

    return results
  }

  private buildBatches(texts: string[]): string[][] {
    const batches: string[][] = []
    let current: string[] = []
    let currentTokens = 0

    for (const text of texts) {
      const tokens = Math.ceil(text.length / 4)
      if (
        current.length > 0 &&
        (current.length >= this.batchSize || currentTokens + tokens > this.maxTokensPerBatch)
      ) {
        batches.push(current)
        current = []
        currentTokens = 0
      }
      current.push(text)
      currentTokens += tokens
    }

    if (current.length > 0) batches.push(current)
    return batches
  }

  private async embedBatch(texts: string[]): Promise<number[][]> {
    const maxAttempts = 3

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      let response: Response
      try {
        response = await fetch(`${this.baseUrl}/v1/embeddings`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            // API key never logged
            Authorization: `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify({
            model: this.model,
            input: texts,
          }),
        })
      } catch (networkErr) {
        if (attempt < maxAttempts - 1) {
          await sleep(backoffMs(attempt))
          continue
        }
        throw new Error(`OpenAI embedding network error: ${String(networkErr)}`, { cause: networkErr })
      }

      if (response.status === 429 || response.status >= 500) {
        if (attempt < maxAttempts - 1) {
          await sleep(backoffMs(attempt))
          continue
        }
        throw new Error(
          `OpenAI embedding API error after ${maxAttempts} attempts: HTTP ${response.status}`,
        )
      }

      if (!response.ok) {
        throw new Error(`OpenAI embedding API error: HTTP ${response.status}`)
      }

      const body = (await response.json()) as OpenAIEmbeddingResponse
      // Sort by index to ensure order matches input
      const sorted = body.data.slice().sort((a, b) => a.index - b.index)
      return sorted.map((d) => d.embedding)
    }

    // Should not be reachable
    throw new Error('OpenAI embedding: exceeded max attempts')
  }
}

// ── Ollama provider ───────────────────────────────────────────────────────────

interface OllamaEmbeddingResponse {
  embedding: number[]
}

export class OllamaEmbeddingProvider implements EmbeddingProvider {
  readonly model: string
  readonly dimension: number

  private readonly baseUrl: string

  constructor() {
    const model = process.env['OLLAMA_EMBEDDING_MODEL']
    if (!model) throw new Error('OLLAMA_EMBEDDING_MODEL environment variable is required')
    this.model = model
    this.baseUrl = process.env['OLLAMA_BASE_URL'] ?? 'http://localhost:11434'
    // Ollama dimension varies by model; use env override or default to 1536
    this.dimension = parseInt(process.env['EMBEDDING_DIM'] ?? '1536', 10)
  }

  async embed(texts: string[]): Promise<number[][]> {
    // Ollama embeds one at a time
    const results: number[][] = []
    for (const text of texts) {
      const embedding = await this.embedOne(text)
      results.push(embedding)
    }
    return results
  }

  private async embedOne(text: string): Promise<number[]> {
    const maxAttempts = 3

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      let response: Response
      try {
        response = await fetch(`${this.baseUrl}/api/embeddings`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: this.model, prompt: text }),
        })
      } catch (networkErr) {
        if (attempt < maxAttempts - 1) {
          await sleep(backoffMs(attempt))
          continue
        }
        throw new Error(`Ollama embedding network error: ${String(networkErr)}`, { cause: networkErr })
      }

      if (response.status === 429 || response.status >= 500) {
        if (attempt < maxAttempts - 1) {
          await sleep(backoffMs(attempt))
          continue
        }
        throw new Error(
          `Ollama embedding API error after ${maxAttempts} attempts: HTTP ${response.status}`,
        )
      }

      if (!response.ok) {
        throw new Error(`Ollama embedding API error: HTTP ${response.status}`)
      }

      const body = (await response.json()) as OllamaEmbeddingResponse
      return body.embedding
    }

    throw new Error('Ollama embedding: exceeded max attempts')
  }
}

// ── Factory ───────────────────────────────────────────────────────────────────

/**
 * Create an embedding provider based on environment configuration.
 *
 * If OLLAMA_EMBEDDING_MODEL is set → OllamaEmbeddingProvider.
 * Otherwise → OpenAIEmbeddingProvider (requires OPENAI_API_KEY).
 */
export function createEmbeddingProvider(): EmbeddingProvider {
  if (process.env['OLLAMA_EMBEDDING_MODEL']) {
    return new OllamaEmbeddingProvider()
  }
  return new OpenAIEmbeddingProvider()
}
