/**
 * withTenant — the ONLY exported query entry point for tenant data.
 *
 * Callers pass a TenantContext (projectId + userId) and a function that
 * receives the Drizzle db instance plus the context. The function is
 * responsible for scoping all queries to projectId.
 *
 * Raw db client is NOT re-exported from this module or from index.ts.
 */

import type { DrizzleDb } from './client.js';

export interface TenantContext {
  projectId: string;
  userId: string;
}

export async function withTenant<T>(
  ctx: TenantContext,
  fn: (db: DrizzleDb, ctx: TenantContext) => Promise<T>,
): Promise<T> {
  const { getDb } = await import('./client.js');
  const db = await getDb();
  return fn(db, ctx);
}
