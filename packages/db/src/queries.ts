/**
 * Named query functions for complex SQL that lives inside packages/db.
 *
 * These bypass withTenant intentionally:
 * - claimIngestionJob: cross-tenant system queue drain
 * - getThreadAncestry: called only after ProjectMemberGuard has verified access;
 *   projectId filter applied in the CTE anchor to enforce tenant scoping
 * - searchKnowledge: same — projectId is always passed and applied
 */

import { sql } from 'drizzle-orm';
import { getDb } from './client.js';
import type { KnowledgeChunk } from '@bramha/shared';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ConversationNodeRow {
  id: string;
  roomId: string;
  projectId: string;
  parentId: string | null;
  authorType: string;
  userId: string | null;
  persona: string | null;
  content: string;
  metadata: unknown;
  createdAt: Date;
  rev: number;
}

export interface IngestionJobRow {
  id: string;
  fileId: string;
  projectId: string;
  status: string;
  attempt: number;
  errorMsg: string | null;
  queuedAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
}

export type { KnowledgeChunk } from '@bramha/shared';

// ---------------------------------------------------------------------------
// Helper: extract rows from a drizzle execute result.
// Drizzle's PGlite adapter returns Results<T> (has .rows).
// Drizzle's postgres-js adapter returns RowList<T[]> (array-like, no .rows).
// We normalise here.
// ---------------------------------------------------------------------------

function extractRows(result: unknown): Record<string, unknown>[] {
  if (result === null || result === undefined) return [];
  if (typeof result === 'object' && 'rows' in result && Array.isArray((result as { rows: unknown[] }).rows)) {
    return (result as { rows: Record<string, unknown>[] }).rows;
  }
  if (Array.isArray(result)) {
    return result as Record<string, unknown>[];
  }
  return [];
}

// ---------------------------------------------------------------------------
// getThreadAncestry
// Walk parent_id chain from head node up to root (bounded CTE), return root-first.
// ---------------------------------------------------------------------------

export async function getThreadAncestry(
  headNodeId: string,
  projectId: string,
): Promise<ConversationNodeRow[]> {
  const db = await getDb();

  const result: unknown = await db.execute(sql`
    WITH RECURSIVE thread AS (
      SELECT
        n.id,
        n.room_id,
        n.project_id,
        n.parent_id,
        n.author_type,
        n.user_id,
        n.persona,
        n.content,
        n.metadata,
        n.created_at,
        0 AS rev
      FROM conversation_nodes n
      WHERE n.id = ${headNodeId}
        AND n.project_id = ${projectId}
      UNION ALL
      SELECT
        p.id,
        p.room_id,
        p.project_id,
        p.parent_id,
        p.author_type,
        p.user_id,
        p.persona,
        p.content,
        p.metadata,
        p.created_at,
        t.rev + 1
      FROM conversation_nodes p
      JOIN thread t ON p.id = t.parent_id AND t.rev < 1000
    )
    SELECT * FROM thread ORDER BY rev DESC
  `);

  return extractRows(result).map((row) => ({
    id: row['id'] as string,
    roomId: row['room_id'] as string,
    projectId: row['project_id'] as string,
    parentId: (row['parent_id'] as string | null | undefined) ?? null,
    authorType: row['author_type'] as string,
    userId: (row['user_id'] as string | null | undefined) ?? null,
    persona: (row['persona'] as string | null | undefined) ?? null,
    content: row['content'] as string,
    metadata: row['metadata'],
    createdAt: new Date(row['created_at'] as string),
    rev: row['rev'] as number,
  }));
}

// ---------------------------------------------------------------------------
// claimIngestionJob
// Atomically claim one queued job (FOR UPDATE SKIP LOCKED).
// ---------------------------------------------------------------------------

export async function claimIngestionJob(): Promise<IngestionJobRow | null> {
  const db = await getDb();

  const result: unknown = await db.execute(sql`
    UPDATE ingestion_jobs
    SET status = 'running',
        started_at = now(),
        updated_at = now(),
        attempt = attempt + 1
    WHERE id = (
      SELECT id
      FROM ingestion_jobs
      WHERE status = 'pending' AND attempt < 3
      ORDER BY queued_at
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING
      id,
      file_id,
      project_id,
      status,
      attempt,
      error_msg,
      queued_at,
      started_at,
      finished_at
  `);

  const rows = extractRows(result);
  if (rows.length === 0) return null;

  const row = rows[0];
  if (row === undefined) return null;

  return {
    id: row['id'] as string,
    fileId: row['file_id'] as string,
    projectId: row['project_id'] as string,
    status: row['status'] as string,
    attempt: row['attempt'] as number,
    errorMsg: (row['error_msg'] as string | null | undefined) ?? null,
    queuedAt: new Date(row['queued_at'] as string),
    startedAt: row['started_at'] != null ? new Date(row['started_at'] as string) : null,
    finishedAt: row['finished_at'] != null ? new Date(row['finished_at'] as string) : null,
  };
}

// ---------------------------------------------------------------------------
// searchKnowledge
// Hybrid RRF (Reciprocal Rank Fusion) search over file_chunks.
// Combines pgvector cosine similarity (HNSW index) with tsvector full-text
// search (GIN index) via RRF k=60 fusion formula.
//
// Signature: (projectId, queryEmbedding, queryText, k)
// - queryEmbedding: already computed embedding for the user message (reused from select node)
// - queryText: raw user message text (for websearch_to_tsquery)
// ---------------------------------------------------------------------------

export async function searchKnowledge(
  projectId: string,
  queryEmbedding: number[],
  queryText: string,
  k = 6,
): Promise<KnowledgeChunk[]> {
  // If no embedding provided, return empty (nothing to search against).
  if (queryEmbedding.length === 0) return [];

  const db = await getDb();

  // Serialize embedding as a PostgreSQL vector literal e.g. '[0.1,0.2,...]'
  const embeddingLiteral = `[${queryEmbedding.join(',')}]`;

  // websearch_to_tsquery throws on empty string — fall back to vector-only search.
  if (!queryText.trim()) {
    const vectorOnly: unknown = await db.execute(sql`
      SELECT fc.id, fc.file_id, fc.chunk_index, fc.content, fc.token_count, f.filename,
        (1.0 / (60 + ROW_NUMBER() OVER (ORDER BY fc.embedding <=> ${sql.raw(`'${embeddingLiteral}'::vector`)}))) AS rrf_score
      FROM file_chunks fc
      JOIN files f ON f.id = fc.file_id
      WHERE fc.project_id = ${projectId} AND fc.embedding IS NOT NULL
      ORDER BY fc.embedding <=> ${sql.raw(`'${embeddingLiteral}'::vector`)}
      LIMIT ${k}
    `);
    return extractRows(vectorOnly).map((row) => ({
      id: row['id'] as string,
      fileId: row['file_id'] as string,
      chunkIndex: row['chunk_index'] as number,
      content: row['content'] as string,
      filename: row['filename'] as string,
      score: row['rrf_score'] as number,
    }));
  }

  const result: unknown = await db.execute(sql`
    WITH
      vector_ranked AS (
        SELECT
          fc.id,
          fc.file_id,
          fc.chunk_index,
          fc.content,
          fc.token_count,
          f.filename,
          ROW_NUMBER() OVER (
            ORDER BY fc.embedding <=> ${sql.raw(`'${embeddingLiteral}'::vector`)}
          ) AS rank
        FROM file_chunks fc
        JOIN files f ON f.id = fc.file_id
        WHERE fc.project_id = ${projectId}
          AND fc.embedding IS NOT NULL
        ORDER BY fc.embedding <=> ${sql.raw(`'${embeddingLiteral}'::vector`)}
        LIMIT 20
      ),
      text_ranked AS (
        SELECT
          fc.id,
          fc.file_id,
          fc.chunk_index,
          fc.content,
          fc.token_count,
          f.filename,
          ROW_NUMBER() OVER (
            ORDER BY ts_rank(fc.tsv, websearch_to_tsquery('english', ${queryText})) DESC
          ) AS rank
        FROM file_chunks fc
        JOIN files f ON f.id = fc.file_id
        WHERE fc.project_id = ${projectId}
          AND fc.tsv @@ websearch_to_tsquery('english', ${queryText})
        LIMIT 20
      ),
      combined AS (
        SELECT
          COALESCE(v.id, t.id) AS id,
          COALESCE(v.file_id, t.file_id) AS file_id,
          COALESCE(v.chunk_index, t.chunk_index) AS chunk_index,
          COALESCE(v.content, t.content) AS content,
          COALESCE(v.token_count, t.token_count) AS token_count,
          COALESCE(v.filename, t.filename) AS filename,
          (
            COALESCE(1.0 / (60 + v.rank), 0.0) +
            COALESCE(1.0 / (60 + t.rank), 0.0)
          ) AS rrf_score
        FROM vector_ranked v
        FULL OUTER JOIN text_ranked t ON v.id = t.id
      )
    SELECT * FROM combined
    ORDER BY rrf_score DESC
    LIMIT ${k}
  `);

  return extractRows(result).map((row) => ({
    id: row['id'] as string,
    fileId: row['file_id'] as string,
    chunkIndex: row['chunk_index'] as number,
    content: row['content'] as string,
    filename: row['filename'] as string,
    score: row['rrf_score'] as number,
  }));
}
