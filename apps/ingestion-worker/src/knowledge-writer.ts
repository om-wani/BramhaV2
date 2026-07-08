/**
 * Knowledge chunk DB writer.
 *
 * Upserts chunks into knowledge_chunks using a stale-swap pattern to ensure
 * re-ingesting the same file atomically replaces old chunks with new ones.
 *
 * Pattern:
 *   1. Mark existing (origin, origin_id) chunks as stale=true
 *   2. INSERT new chunks with ON CONFLICT … DO UPDATE stale=false
 *   3. DELETE remaining stale=true rows (old chunks not replaced by new)
 */
import type postgres from 'postgres'
import type { EmbeddedChunk } from './embedder.js'

const BATCH_SIZE = 500

export interface UpsertKnowledgeChunksParams {
  projectId: string
  origin: 'upload' | 'source' | 'ceo_office' | 'conversation_summary' | 'artifact'
  originId: string
  chunks: EmbeddedChunk[]
  sql: postgres.Sql
}

export async function upsertKnowledgeChunks(params: UpsertKnowledgeChunksParams): Promise<void> {
  const { projectId, origin, originId, chunks, sql } = params

  // ── Step 1: Mark all existing chunks for this origin as stale ────────────
  // This ensures concurrent readers see old chunks until new ones land.
  await sql`
    UPDATE knowledge_chunks
    SET stale = true
    WHERE origin    = ${origin}
      AND origin_id = ${originId}::uuid
  `

  // ── Step 2: Upsert chunks in batches ─────────────────────────────────────
  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    const batch = chunks.slice(i, i + BATCH_SIZE)

    for (const chunk of batch) {
      // Pass embedding as pgvector string; postgres.js passes it through as-is
      const embeddingStr = `[${chunk.embedding.join(',')}]`

      await sql`
        INSERT INTO knowledge_chunks
          (project_id, origin, origin_id, chunk_index, heading_trail, content, embedding, token_count, stale)
        VALUES (
          ${projectId}::uuid,
          ${origin},
          ${originId}::uuid,
          ${chunk.chunkIndex},
          ${chunk.headingTrail},
          ${chunk.content},
          ${embeddingStr}::vector(1536),
          ${chunk.tokenCount},
          false
        )
        ON CONFLICT (origin, origin_id, chunk_index) DO UPDATE
          SET
            content     = EXCLUDED.content,
            embedding   = EXCLUDED.embedding,
            token_count = EXCLUDED.token_count,
            stale       = false
      `
    }
  }

  // ── Step 3: Delete stale chunks that were not replaced ────────────────────
  // Any rows still stale=true after the upsert are old chunks with no
  // corresponding new chunk (e.g., file was shortened on re-ingest).
  await sql`
    DELETE FROM knowledge_chunks
    WHERE origin    = ${origin}
      AND origin_id = ${originId}::uuid
      AND stale     = true
  `
}
