import { Injectable } from '@nestjs/common';
import { desc, eq } from 'drizzle-orm';
import { getDb, feedback, users } from '@bramha/db';

export interface FeedbackRow {
  id: string;
  content: string;
  path: string | null;
  createdAt: string;
}

export interface AdminFeedbackRow extends FeedbackRow {
  userId: string;
  userEmail: string;
  userName: string | null;
}

@Injectable()
export class FeedbackService {
  async create(userId: string, content: string, path: string | null): Promise<FeedbackRow> {
    const db = await getDb();
    const [row] = await db
      .insert(feedback)
      .values({ userId, content, path })
      .returning();
    if (!row) throw new Error('feedback insert failed');
    return {
      id: row.id,
      content: row.content,
      path: row.path,
      createdAt: row.createdAt.toISOString(),
    };
  }

  /** A user's own submitted feedback, newest first. Immutable once created. */
  async listMine(userId: string): Promise<FeedbackRow[]> {
    const db = await getDb();
    const rows = await db
      .select({
        id: feedback.id,
        content: feedback.content,
        path: feedback.path,
        createdAt: feedback.createdAt,
      })
      .from(feedback)
      .where(eq(feedback.userId, userId))
      .orderBy(desc(feedback.createdAt));
    return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
  }

  /** All feedback with author info — admin only. */
  async listAll(): Promise<AdminFeedbackRow[]> {
    const db = await getDb();
    const rows = await db
      .select({
        id: feedback.id,
        content: feedback.content,
        path: feedback.path,
        createdAt: feedback.createdAt,
        userId: feedback.userId,
        userEmail: users.email,
        userName: users.name,
      })
      .from(feedback)
      .innerJoin(users, eq(feedback.userId, users.id))
      .orderBy(desc(feedback.createdAt));
    return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
  }
}
