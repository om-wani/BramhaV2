/**
 * Test: migration runner with PGlite (no external DB required).
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '../migrations');

// ---------------------------------------------------------------------------
// Minimal migration runner that works on a provided PGlite instance directly.
// (The main migrate.ts creates its own singleton; here we use a fresh instance
//  per test run so tests don't share state with the package singleton.)
// ---------------------------------------------------------------------------

async function runMigrationsOnInstance(db: PGlite): Promise<void> {
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
    const { rows: applied } = await db.query<{ version: string }>(
      'SELECT version FROM schema_migrations WHERE version = $1',
      [version],
    );
    if (applied.length > 0) continue;

    const sql = await readFile(join(MIGRATIONS_DIR, file), 'utf8');
    await db.exec('BEGIN');
    try {
      await db.exec(sql);
      await db.query('INSERT INTO schema_migrations (version) VALUES ($1)', [version]);
      await db.exec('COMMIT');
    } catch (err) {
      await db.exec('ROLLBACK');
      throw new Error(`Migration ${version} failed: ${String(err)}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('migrate', () => {
  let db: PGlite;

  beforeAll(async () => {
    // Use an in-memory PGlite instance for isolation
    db = new PGlite({ extensions: { vector } });
    await db.waitReady;
    await runMigrationsOnInstance(db);
  });

  it('records 0001_init in schema_migrations', async () => {
    const { rows } = await db.query<{ version: string }>(
      'SELECT version FROM schema_migrations ORDER BY version',
    );
    const versions = rows.map((r) => r.version);
    expect(versions).toContain('0001_init');
  });

  it('creates users table', async () => {
    const { rows } = await db.query<{ tablename: string }>(
      "SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename='users'",
    );
    expect(rows.length).toBe(1);
  });

  it('creates conversation_nodes table', async () => {
    const { rows } = await db.query<{ tablename: string }>(
      "SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename='conversation_nodes'",
    );
    expect(rows.length).toBe(1);
  });

  it('creates file_chunks table', async () => {
    const { rows } = await db.query<{ tablename: string }>(
      "SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename='file_chunks'",
    );
    expect(rows.length).toBe(1);
  });

  it('creates all expected tables', async () => {
    const expectedTables = [
      'users',
      'sessions',
      'orgs',
      'org_members',
      'projects',
      'project_members',
      'rooms',
      'branches',
      'conversation_nodes',
      'files',
      'file_chunks',
      'ingestion_jobs',
      'delegation_tasks',
      'model_calls',
    ];

    const { rows } = await db.query<{ tablename: string }>(
      "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename",
    );
    const actual = rows.map((r) => r.tablename);

    for (const table of expectedTables) {
      expect(actual, `Expected table ${table} to exist`).toContain(table);
    }
  });

  it('is idempotent — running migrations twice does not error', async () => {
    // Should skip already-applied migrations silently
    await expect(runMigrationsOnInstance(db)).resolves.toBeUndefined();
  });
});
