import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import {
  getDb,
  users,
  feedback,
  sessions,
  orgs,
  orgMembers,
  projects,
  projectMembers,
  rooms,
  branches,
  conversationNodes,
  files,
  fileChunks,
  ingestionJobs,
  delegationTasks,
  modelCalls,
} from '@bramha/db';
import type { PgTable } from 'drizzle-orm/pg-core';

// Whitelist of tables godmode can read/delete. Names are stable API identifiers.
const TABLES: Record<string, PgTable> = {
  users,
  feedback,
  sessions,
  orgs,
  org_members: orgMembers,
  projects,
  project_members: projectMembers,
  rooms,
  branches,
  conversation_nodes: conversationNodes,
  files,
  file_chunks: fileChunks,
  ingestion_jobs: ingestionJobs,
  delegation_tasks: delegationTasks,
  model_calls: modelCalls,
};

// Columns to blank out before returning (never leak secrets to the panel).
const REDACT: Record<string, string[]> = {
  users: ['passwordHash'],
  sessions: ['tokenHash'],
  file_chunks: ['embedding'],
};

function tableOrThrow(name: string): PgTable {
  const t = TABLES[name];
  if (!t) throw new BadRequestException({ code: 'UNKNOWN_TABLE', title: `Unknown table: ${name}` });
  return t;
}

function redactRows(name: string, rows: Record<string, unknown>[]): Record<string, unknown>[] {
  const cols = REDACT[name];
  if (!cols) return rows;
  return rows.map((r) => {
    const copy = { ...r };
    for (const c of cols) if (c in copy) copy[c] = '«redacted»';
    return copy;
  });
}

@Injectable()
export class AdminService {
  tableNames(): string[] {
    return Object.keys(TABLES);
  }

  async overview(): Promise<Record<string, number>> {
    const db = await getDb();
    const out: Record<string, number> = {};
    for (const [name, table] of Object.entries(TABLES)) {
      const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(table);
      out[name] = row?.n ?? 0;
    }
    return out;
  }

  async listTable(name: string, limit = 200): Promise<Record<string, unknown>[]> {
    const table = tableOrThrow(name);
    const db = await getDb();
    const rows = (await db.select().from(table).limit(limit)) as Record<string, unknown>[];
    return redactRows(name, rows);
  }

  async deleteRow(name: string, id: string): Promise<void> {
    const table = tableOrThrow(name);
    const db = await getDb();
    // Every whitelisted table has a uuid `id` PK.
    const idCol = (table as unknown as { id: Parameters<typeof eq>[0] }).id;
    const deleted = await db.delete(table).where(eq(idCol, id)).returning();
    if (deleted.length === 0) {
      throw new NotFoundException({ code: 'NOT_FOUND', title: 'Row not found' });
    }
  }

  async setUserAdmin(userId: string, isAdmin: boolean): Promise<void> {
    const db = await getDb();
    const updated = await db
      .update(users)
      .set({ isAdmin })
      .where(eq(users.id, userId))
      .returning();
    if (updated.length === 0) {
      throw new NotFoundException({ code: 'NOT_FOUND', title: 'User not found' });
    }
  }

  /** Set (or clear, with null) a user's total-token cap. */
  async setUserLimit(userId: string, tokenLimit: number | null): Promise<void> {
    const db = await getDb();
    const updated = await db
      .update(users)
      .set({ usageTokenLimit: tokenLimit })
      .where(eq(users.id, userId))
      .returning();
    if (updated.length === 0) {
      throw new NotFoundException({ code: 'NOT_FOUND', title: 'User not found' });
    }
  }

  /** Per-user usage: tokens, calls, estimated cost, and current limit. */
  async userUsage(): Promise<
    Array<{
      userId: string;
      email: string;
      name: string;
      isAdmin: boolean;
      tokens: number;
      calls: number;
      costUsd: number;
      limit: number | null;
    }>
  > {
    const db = await getDb();

    // Base per-user tokens/calls (left join so 0-usage users still appear).
    const base = await db
      .select({
        userId: users.id,
        email: users.email,
        name: users.name,
        isAdmin: users.isAdmin,
        limit: users.usageTokenLimit,
        tokens: sql<number>`coalesce(sum(${modelCalls.inputTokens} + ${modelCalls.outputTokens}), 0)::int`,
        calls: sql<number>`count(${modelCalls.id})::int`,
      })
      .from(users)
      .leftJoin(modelCalls, eq(modelCalls.userId, users.id))
      .groupBy(users.id);

    // Cost needs per-model pricing → group by (user, model), estimate, sum.
    const perModel = await db
      .select({
        userId: modelCalls.userId,
        model: modelCalls.model,
        inTok: sql<number>`coalesce(sum(${modelCalls.inputTokens}), 0)::int`,
        outTok: sql<number>`coalesce(sum(${modelCalls.outputTokens}), 0)::int`,
      })
      .from(modelCalls)
      .groupBy(modelCalls.userId, modelCalls.model);

    const costByUser = new Map<string, number>();
    for (const r of perModel) {
      if (!r.userId) continue;
      const cost = estimateCostUsd(r.model, r.inTok, r.outTok);
      costByUser.set(r.userId, (costByUser.get(r.userId) ?? 0) + cost);
    }

    return base
      .map((b) => ({
        userId: b.userId,
        email: b.email,
        name: b.name,
        isAdmin: b.isAdmin,
        tokens: b.tokens,
        calls: b.calls,
        costUsd: costByUser.get(b.userId) ?? 0,
        limit: b.limit ?? null,
      }))
      .sort((a, b) => b.tokens - a.tokens);
  }
}

// Pricing (USD per 1M tokens) — estimates only.
const PRICES_PER_MTOK: Array<{ match: string; input: number; output: number }> = [
  { match: 'claude-sonnet', input: 3, output: 15 },
  { match: 'kimi-k2.6', input: 0.68, output: 3.42 },
  { match: 'llama-3.3-70b', input: 0.13, output: 0.4 },
  { match: 'gpt-4o-mini', input: 0.15, output: 0.6 },
  { match: 'gpt-4o', input: 2.5, output: 10 },
  { match: 'text-embedding-3-small', input: 0.02, output: 0 },
];

function estimateCostUsd(model: string, inputTokens: number, outputTokens: number): number {
  const p = PRICES_PER_MTOK.find((x) => model.includes(x.match));
  if (!p) return 0;
  return (inputTokens * p.input + outputTokens * p.output) / 1_000_000;
}
