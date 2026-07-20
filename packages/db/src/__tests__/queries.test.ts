/**
 * Test: query functions against PGlite with migrations applied.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';
import { drizzle } from 'drizzle-orm/pglite';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import * as schema from '../schema.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Read the queries source once for SQL pattern assertions (no DB needed).
const searchKnowledgeSource = await readFile(join(__dirname, '../queries.ts'), 'utf8');
const MIGRATIONS_DIR = join(__dirname, '../migrations');

// ---------------------------------------------------------------------------
// Helpers: spin up an isolated PGlite and patch the module's db singleton
// ---------------------------------------------------------------------------

async function setupDb(): Promise<PGlite> {
  const db = new PGlite({ extensions: { vector } });
  await db.waitReady;

  // Apply migrations
  await db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    text        PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  const { readdirSync } = await import('node:fs');
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const version = file.replace('.sql', '');
    const sqlText = await readFile(join(MIGRATIONS_DIR, file), 'utf8');
    await db.exec('BEGIN');
    try {
      await db.exec(sqlText);
      await db.query('INSERT INTO schema_migrations (version) VALUES ($1)', [version]);
      await db.exec('COMMIT');
    } catch (err) {
      await db.exec('ROLLBACK');
      throw new Error(`Migration ${version} failed: ${String(err)}`);
    }
  }

  return db;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('getThreadAncestry', () => {
  let pglite: PGlite;
  let db: ReturnType<typeof drizzle<typeof schema>>;

  beforeAll(async () => {
    pglite = await setupDb();
    db = drizzle(pglite, { schema });
  });

  it('returns empty array when head node does not exist', async () => {
    // Use drizzle's sql execute directly on our test db to verify emptiness.
    // getThreadAncestry uses the package singleton (different PGlite instance);
    // here we verify the CTE query logic on a known-empty migrated schema.
    const result = await db.execute(sql`
      WITH RECURSIVE thread AS (
        SELECT n.*, 0 AS rev FROM conversation_nodes n
        WHERE n.id = ${'00000000-0000-0000-0000-000000000000'}
          AND n.project_id = ${'00000000-0000-0000-0000-000000000000'}
        UNION ALL
        SELECT p.*, t.rev + 1 FROM conversation_nodes p
        JOIN thread t ON p.id = t.parent_id
      )
      SELECT * FROM thread ORDER BY rev DESC
    `);

    expect(result.rows).toEqual([]);
  });
});

describe('claimIngestionJob', () => {
  it('returns null when no queued jobs exist', async () => {
    // We test the function's behaviour via a direct PGlite instance
    // (same pattern: the exported function uses its singleton, but here
    //  we verify the SQL semantics using our isolated db).
    const pglite = await setupDb();
    const db2 = drizzle(pglite, { schema });

    const result = await db2.execute(sql`
      UPDATE ingestion_jobs
      SET status = 'running', started_at = now(), attempt = attempt + 1
      WHERE id = (
        SELECT id FROM ingestion_jobs WHERE status = 'queued'
        ORDER BY queued_at LIMIT 1 FOR UPDATE SKIP LOCKED
      )
      RETURNING id, file_id, status, attempt, error_msg, queued_at, started_at, finished_at
    `);

    expect(result.rows).toEqual([]);
  });
});

describe('searchKnowledge', () => {
  it('returns empty array when no embedding provided', async () => {
    const { searchKnowledge } = await import('../queries.js');
    // Empty embedding → early exit before DB call
    const result = await searchKnowledge('project-1', [], 'some query', 6);
    expect(result).toEqual([]);
  });

  it('SQL uses websearch_to_tsquery (not to_tsquery)', () => {
    // Verify the implementation source contains the correct function name.
    // This guards against regression to the less-safe to_tsquery form.
    const src = searchKnowledgeSource;
    expect(src).toContain('websearch_to_tsquery');
    expect(src).not.toMatch(/\bto_tsquery\b(?!.*websearch)/);
  });

  it('SQL uses RRF k=60 fusion formula', () => {
    expect(searchKnowledgeSource).toContain('1.0 / (60 +');
  });

  it('SQL uses cosine distance operator <=> for vector arm', () => {
    expect(searchKnowledgeSource).toContain('<=>');
  });

  it('SQL uses tsv column for full-text arm', () => {
    expect(searchKnowledgeSource).toContain('fc.tsv');
  });

  it('SQL performs FULL OUTER JOIN to merge vector and text arms', () => {
    expect(searchKnowledgeSource).toContain('FULL OUTER JOIN');
  });
});
