/**
 * Named query functions for complex SQL that lives inside packages/db.
 *
 * These are called from apps/server modules. They manage their own db access
 * (not via withTenant, since they may need cross-tenant or system-level ops).
 */

import { sql } from 'drizzle-orm';
import { getDb } from './client.js';

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
  status: string;
  attempt: number;
  errorMsg: string | null;
  queuedAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
}

export interface KnowledgeChunk {
  id: string;
  content: string;
  chunkIndex: number;
  filename: string;
  score: number;
}

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
      JOIN thread t ON p.id = t.parent_id
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
        attempt = attempt + 1
    WHERE id = (
      SELECT id
      FROM ingestion_jobs
      WHERE status = 'queued'
      ORDER BY queued_at
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING
      id,
      file_id,
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
// Hybrid RRF search (stub until P4.3).
// ---------------------------------------------------------------------------

export async function searchKnowledge(
  projectId: string,
  queryText: string,
  queryEmbedding: number[],
  k = 6,
): Promise<KnowledgeChunk[]> {
  // Stubbed — implemented in P4.3 (RAG phase).
  // The full query is documented in docs/02_mvp_data_model.md §4.
  void projectId;
  void queryText;
  void queryEmbedding;
  void k;
  return [];
}
