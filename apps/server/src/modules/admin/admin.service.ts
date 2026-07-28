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
}
