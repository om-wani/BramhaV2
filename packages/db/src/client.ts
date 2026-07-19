/**
 * DB client factory — package-private, NOT exported from index.ts
 *
 * - DATABASE_URL set  → postgres-js → drizzle/postgres-js
 * - DATABASE_URL unset → PGlite at .data/pglite → drizzle/pglite
 *
 * Singleton per process.
 */

import { mkdirSync } from 'node:fs';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import { drizzle as drizzlePg } from 'drizzle-orm/postgres-js';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';
import postgres from 'postgres';
import * as schema from './schema.js';

type PgliteDb = ReturnType<typeof drizzlePglite<typeof schema>>;
type PgDb = ReturnType<typeof drizzlePg<typeof schema>>;

export type DrizzleDb = PgliteDb | PgDb;

let _db: DrizzleDb | null = null;
let _pglite: PGlite | null = null;

export async function getDb(): Promise<DrizzleDb> {
  if (_db) return _db;

  const databaseUrl = process.env['DATABASE_URL'];

  if (databaseUrl) {
    const sql = postgres(databaseUrl, { max: 10 });
    _db = drizzlePg(sql, { schema }) as DrizzleDb;
  } else {
    const dataDir = process.env['PGLITE_DATA_DIR'] ?? '.data/pglite';
    mkdirSync(dataDir, { recursive: true });
    _pglite = new PGlite(dataDir, { extensions: { vector } });
    await _pglite.waitReady;
    _db = drizzlePglite(_pglite, { schema }) as DrizzleDb;
  }

  return _db;
}

/** For migration runner and tests to run raw SQL directly on PGlite. */
export async function getRawPglite(): Promise<PGlite | null> {
  await getDb(); // ensure initialized
  return _pglite;
}
