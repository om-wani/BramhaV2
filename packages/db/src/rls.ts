import type postgres from 'postgres'
import { sql } from './client.js'

export interface TenantContext {
  userId: string
  projectId?: string | null
}

/**
 * Wraps a database operation in a transaction with RLS context set via GUCs.
 * This is the ONLY way to query the database from application code.
 *
 * The `fn` callback receives a `TransactionSql` handle; callers MUST NOT
 * capture or leak `tx` outside the callback.
 */
export async function withTenant<T>(
  fn: (tx: postgres.TransactionSql) => Promise<T>,
  ctx: TenantContext,
): Promise<T> {
  // sql.begin returns Promise<UnwrapPromiseArray<T>>; for non-array T this equals T.
  // The cast is safe because our fn's return type is always a single value, never a raw array
  // of promises that postgres would unwrap differently.
  return sql.begin(async (tx) => {
    await tx`SET LOCAL app.user_id = ${ctx.userId}`
    if (ctx.projectId) {
      await tx`SET LOCAL app.project_id = ${ctx.projectId}`
    } else {
      await tx`SET LOCAL app.project_id = ''`
    }
    return fn(tx)
  }) as Promise<T>
}
