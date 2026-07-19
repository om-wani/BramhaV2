/**
 * Raw SQL migration runner.
 *
 * - Reads *.sql files from src/migrations/ in alphabetical order.
 * - Maintains schema_migrations(version text PK, applied_at timestamptz).
 * - Each migration runs in a transaction; version is inserted on success.
 * - Skips already-applied versions.
 * - Works with both PGlite (local dev) and postgres-js (deployed).
 *
 * Called at server bootstrap and via `pnpm db:migrate`.
 */

import { readdir, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, 'migrations');

// ---------------------------------------------------------------------------
// Adaptor: normalise PGlite and postgres-js query signatures to one shape
// ---------------------------------------------------------------------------

interface QueryResult {
  rows: Record<string, unknown>[];
}

interface RawRunner {
  query(sql: string, params?: unknown[]): Promise<QueryResult>;
  beginTransaction(): Promise<void>;
  commitTransaction(): Promise<void>;
  rollbackTransaction(): Promise<void>;
}

interface RawRunnerWithTeardown extends RawRunner {
  teardown(): Promise<void>;
}

async function buildRunner(): Promise<RawRunnerWithTeardown> {
  const databaseUrl = process.env['DATABASE_URL'];

  if (databaseUrl) {
    // postgres-js
    const postgres = await import('postgres');
    const sql = postgres.default(databaseUrl, { max: 1 });

    let inTx = false;

    return {
      async query(rawSql: string, params?: unknown[]) {
        // Use overloaded form to avoid never[] cast
        const result = params !== undefined && params.length > 0
          ? await sql.unsafe(rawSql, params as Parameters<typeof sql.unsafe>[1])
          : await sql.unsafe(rawSql);
        return { rows: result as unknown as Record<string, unknown>[] };
      },
      async beginTransaction() {
        if (!inTx) { await sql.unsafe('BEGIN'); inTx = true; }
      },
      async commitTransaction() {
        if (inTx) { await sql.unsafe('COMMIT'); inTx = false; }
      },
      async rollbackTransaction() {
        if (inTx) { await sql.unsafe('ROLLBACK'); inTx = false; }
      },
      async teardown() { await sql.end(); },
    };
  } else {
    // PGlite
    const { PGlite } = await import('@electric-sql/pglite');
    const { vector } = await import('@electric-sql/pglite-pgvector');
    const { mkdirSync } = await import('node:fs');
    const dataDir = process.env['PGLITE_DATA_DIR'] ?? '.data/pglite';
    mkdirSync(dataDir, { recursive: true });
    const pglite = new PGlite(dataDir, { extensions: { vector } });
    await pglite.waitReady;

    return {
      async query(rawSql: string, params?: unknown[]) {
        if (params !== undefined && params.length > 0) {
          // Single parameterized statement
          const result = await pglite.query<Record<string, unknown>>(rawSql, params);
          return { rows: result.rows };
        }
        // exec() handles multiple statements (e.g. migration files)
        const results = await pglite.exec(rawSql);
        const last = results[results.length - 1];
        return { rows: (last?.rows ?? []) as Record<string, unknown>[] };
      },
      async beginTransaction() { await pglite.exec('BEGIN'); },
      async commitTransaction() { await pglite.exec('COMMIT'); },
      async rollbackTransaction() { await pglite.exec('ROLLBACK'); },
      async teardown() { /* PGlite: no explicit close needed */ },
    };
  }
}

// ---------------------------------------------------------------------------
// migrate()
// ---------------------------------------------------------------------------

export async function migrate(): Promise<void> {
  const runner = await buildRunner();
  try {
    await runMigrations(runner);
  } finally {
    await runner.teardown();
  }
}

async function runMigrations(runner: RawRunner): Promise<void> {

  // Ensure bookkeeping table exists (outside a transaction — idempotent DDL)
  await runner.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    text        PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  // Find already-applied versions
  const { rows: applied } = await runner.query(
    'SELECT version FROM schema_migrations ORDER BY version',
  );
  const appliedSet = new Set(applied.map((r) => r['version'] as string));

  // Discover migration files
  const files = (await readdir(MIGRATIONS_DIR))
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const version = file.replace('.sql', '');
    if (appliedSet.has(version)) {
      console.log(`[migrate] skip  ${version} (already applied)`);
      continue;
    }

    const sqlPath = join(MIGRATIONS_DIR, file);
    const sql = await readFile(sqlPath, 'utf8');

    const start = Date.now();
    console.log(`[migrate] apply ${version} …`);

    await runner.beginTransaction();
    try {
      await runner.query(sql);
      await runner.query(
        'INSERT INTO schema_migrations (version) VALUES ($1)',
        [version],
      );
      await runner.commitTransaction();
    } catch (err) {
      await runner.rollbackTransaction();
      throw new Error(`Migration ${version} failed: ${String(err)}`);
    }

    const ms = Date.now() - start;
    console.log(`[migrate] done  ${version} (${ms}ms)`);
  }
}

// ---------------------------------------------------------------------------
// CLI entry point: `pnpm db:migrate` calls this file directly via tsx
// ---------------------------------------------------------------------------
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  migrate()
    .then(() => {
      console.log('[migrate] all migrations applied');
      process.exit(0);
    })
    .catch((err) => {
      console.error('[migrate] error:', err);
      process.exit(1);
    });
}
