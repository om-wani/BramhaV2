/**
 * Embedding pipeline — wraps EmbeddingProvider for batch processing of chunks.
 *
 * Security: chunk text is NEVER logged — only chunk IDs and counts.
 */
import type { EmbeddingProvider } from '@bramha/agents'
import type { Chunk } from './chunking.js'

export interface EmbeddedChunk extends Chunk {
  embedding: number[]
}

/**
 * Embed all chunks using the provided EmbeddingProvider.
 *
 * Batches up to 100 chunks per API call (further limited by the provider's
 * own token budget). Throws on failure after provider's internal retries.
 *
 * @param chunks - Chunks to embed
 * @param provider - EmbeddingProvider instance
 */
export async function embedChunks(
  chunks: Chunk[],
  provider: EmbeddingProvider,
): Promise<EmbeddedChunk[]> {
  if (chunks.length === 0) return []

  const BATCH_SIZE = 100
  const results: EmbeddedChunk[] = []

  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    const batch = chunks.slice(i, i + BATCH_SIZE)
    // Only log counts — never log text content
    console.log(
      JSON.stringify({
        event: 'embedder.batch',
        batchStart: i,
        batchSize: batch.length,
        model: provider.model,
      }),
    )

    const texts = batch.map((c) => c.content)
    let embeddings: number[][]
    try {
      embeddings = await provider.embed(texts)
    } catch (err) {
      throw new Error(
        `Embedding failed for batch starting at index ${i} (${batch.length} chunks): ${String(err)}`,
        { cause: err },
      )
    }

    batch.forEach((chunk, j) => {
      results.push({
        ...chunk,
        // eslint-disable-next-line security/detect-object-injection
        embedding: embeddings[j]!,
      })
    })
  }

  return results
}
