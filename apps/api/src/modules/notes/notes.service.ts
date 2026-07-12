import { Injectable, BadRequestException, NotFoundException, Logger, Inject, OnModuleDestroy } from '@nestjs/common'
import { z } from 'zod'
import { Queue } from 'bullmq'
import type { Redis } from 'ioredis'
import type postgres from 'postgres'
import { RlsDbService } from '../common/db/rls-db.service.js'
import { REDIS_CLIENT } from '../common/redis/redis.module.js'
import type { Note, CreateNoteInput, UpdateNoteInput } from '@bramha/shared'

// Content sanitization — reject if contentMd contains script injection
const SCRIPT_PATTERN = /<script/i
const JS_PATTERN = /javascript:/i

function sanitizeContentMd(contentMd: string): void {
  if (SCRIPT_PATTERN.test(contentMd) || JS_PATTERN.test(contentMd)) {
    throw new BadRequestException({ code: 'content_injection', message: 'Content contains disallowed script patterns' })
  }
}

// Wikilink parser — extracts [[Title]] references from markdown
function parseWikilinks(content: string): string[] {
  const matches = content.matchAll(/\[\[([^\]]+)\]\]/g)
  return [...matches].map(m => m[1]!.trim())
}

// Folder path validator — blocks traversal and disallowed characters
const FOLDER_PATH_SCHEMA = z.string().regex(/^\/(?!.*\.\.)[^<>:"\\|?*]*$/)

// Row type from DB
interface NoteRow {
  id: string
  project_id: string
  author_id: string
  title: string
  content_md: string
  content_json: unknown
  folder_path: string
  is_daily: boolean
  deleted_at: string | null
  created_at: string
  updated_at: string
}

function mapNote(r: NoteRow): Note {
  return {
    id: r.id,
    projectId: r.project_id,
    authorId: r.author_id,
    title: r.title,
    contentMd: r.content_md,
    contentJson: r.content_json ?? null,
    folderPath: r.folder_path,
    isDaily: r.is_daily,
    deletedAt: r.deleted_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

type Tx = postgres.TransactionSql

// Must outlive the job delay (5s) plus expected queue poll latency; 30s is a safe margin.
const DEBOUNCE_TTL_SECONDS = 30
const DEBOUNCE_DELAY_MS = 5000

@Injectable()
export class NotesService implements OnModuleDestroy {
  private readonly logger = new Logger(NotesService.name)
  private readonly noteDeltaQueue: Queue

  constructor(
    private readonly db: RlsDbService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {
    this.noteDeltaQueue = new Queue('note-delta', {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      connection: redis as any,
    })
  }

  async onModuleDestroy(): Promise<void> {
    await this.noteDeltaQueue.close()
  }

  // ── Create ─────────────────────────────────────────────────────────────────

  async create(userId: string, projectId: string, input: CreateNoteInput): Promise<Note> {
    sanitizeContentMd(input.contentMd)

    // Fold note insert + wikilink sync into one atomic transaction
    const row = await this.db.run({ userId, projectId }, async (tx: Tx) => {
      const rows = await tx<NoteRow[]>`
        INSERT INTO notes (project_id, author_id, title, content_md, content_json, folder_path, is_daily)
        VALUES (
          ${projectId}::uuid,
          ${userId}::uuid,
          ${input.title},
          ${input.contentMd},
          ${input.contentJson !== undefined ? JSON.stringify(input.contentJson) : null}::jsonb,
          ${input.folderPath ?? '/'},
          ${input.isDaily ?? false}
        )
        RETURNING id, project_id, author_id, title, content_md, content_json, folder_path, is_daily,
                  deleted_at, created_at, updated_at
      `
      const inserted = rows[0]!
      await this.updateNoteLinksInTx(tx, inserted.id, projectId, input.contentMd)
      return inserted
    })

    // Enqueue note.delta AFTER tx committed (best-effort; re-triggered on next save if this fails)
    try {
      await this.enqueueNoteDelta(row.id, projectId, input.contentMd)
    } catch (err) {
      this.logger.warn({ event: 'notes.enqueue_delta_failed', noteId: row.id, err: String(err) })
    }

    this.logger.log({ event: 'note.created', userId, projectId, noteId: row.id })
    return mapNote(row)
  }

  // ── List ───────────────────────────────────────────────────────────────────

  async list(userId: string, projectId: string, folderPath?: string): Promise<Note[]> {
    if (folderPath !== undefined) {
      const result = FOLDER_PATH_SCHEMA.safeParse(folderPath)
      if (!result.success) throw new BadRequestException('Invalid folder path')
    }

    const rows = await this.db.run({ userId, projectId }, async (tx: Tx) => {
      if (folderPath !== undefined) {
        return tx<NoteRow[]>`
          SELECT id, project_id, author_id, title, content_md, content_json, folder_path, is_daily,
                 deleted_at, created_at, updated_at
          FROM notes
          WHERE project_id = ${projectId}::uuid AND deleted_at IS NULL AND folder_path = ${folderPath}
          ORDER BY created_at DESC
        `
      }
      return tx<NoteRow[]>`
        SELECT id, project_id, author_id, title, content_md, content_json, folder_path, is_daily,
               deleted_at, created_at, updated_at
        FROM notes
        WHERE project_id = ${projectId}::uuid AND deleted_at IS NULL
        ORDER BY created_at DESC
      `
    })
    return rows.map(mapNote)
  }

  // ── Get ────────────────────────────────────────────────────────────────────

  async get(userId: string, projectId: string, noteId: string): Promise<Note> {
    const rows = await this.db.run({ userId, projectId }, async (tx: Tx) => {
      return tx<NoteRow[]>`
        SELECT id, project_id, author_id, title, content_md, content_json, folder_path, is_daily,
               deleted_at, created_at, updated_at
        FROM notes
        WHERE id = ${noteId}::uuid AND project_id = ${projectId}::uuid
      `
    })
    if (!rows[0]) throw new NotFoundException({ code: 'note_not_found' })
    return mapNote(rows[0])
  }

  // ── Update ─────────────────────────────────────────────────────────────────

  async update(userId: string, projectId: string, noteId: string, input: UpdateNoteInput): Promise<Note> {
    if (input.contentMd !== undefined) {
      sanitizeContentMd(input.contentMd)
    }

    // Fold note update + wikilink sync into one atomic transaction
    const row = await this.db.run({ userId, projectId }, async (tx: Tx) => {
      const rows = await tx<NoteRow[]>`
        UPDATE notes
        SET
          title       = COALESCE(${input.title ?? null}, title),
          content_md  = COALESCE(${input.contentMd ?? null}, content_md),
          content_json = CASE WHEN ${input.contentJson !== undefined} THEN ${input.contentJson !== undefined ? JSON.stringify(input.contentJson) : null}::jsonb ELSE content_json END,
          folder_path = COALESCE(${input.folderPath ?? null}, folder_path),
          updated_at  = now()
        WHERE id = ${noteId}::uuid AND project_id = ${projectId}::uuid AND deleted_at IS NULL
        RETURNING id, project_id, author_id, title, content_md, content_json, folder_path, is_daily,
                  deleted_at, created_at, updated_at
      `
      const updated = rows[0]
      if (updated !== undefined && input.contentMd !== undefined) {
        await this.updateNoteLinksInTx(tx, noteId, projectId, input.contentMd)
      }
      return updated
    })

    if (!row) throw new NotFoundException({ code: 'note_not_found' })

    // Enqueue note.delta AFTER tx committed (best-effort; re-triggered on next save if this fails)
    if (input.contentMd !== undefined) {
      try {
        await this.enqueueNoteDelta(noteId, projectId, row.content_md)
      } catch (err) {
        this.logger.warn({ event: 'notes.enqueue_delta_failed', noteId, err: String(err) })
      }
    }

    this.logger.log({ event: 'note.updated', userId, projectId, noteId })
    return mapNote(row)
  }

  // ── Delete (soft) ──────────────────────────────────────────────────────────

  async delete(userId: string, projectId: string, noteId: string): Promise<void> {
    await this.db.run({ userId, projectId }, async (tx: Tx) => {
      const rows = await tx<{ id: string }[]>`
        UPDATE notes
        SET deleted_at = now(), updated_at = now()
        WHERE id = ${noteId}::uuid AND project_id = ${projectId}::uuid AND deleted_at IS NULL
        RETURNING id
      `
      if (!rows[0]) throw new NotFoundException({ code: 'note_not_found' })

      // Mark knowledge_chunks stale (housekeeping will clean within 1h)
      await tx`
        UPDATE knowledge_chunks
        SET stale = true
        WHERE origin = 'ceo_office' AND origin_id = ${noteId}::uuid AND project_id = ${projectId}::uuid
      `
    })

    this.logger.log({ event: 'note.deleted', userId, projectId, noteId })
  }

  // ── Restore ────────────────────────────────────────────────────────────────

  async restore(userId: string, projectId: string, noteId: string): Promise<Note> {
    const rows = await this.db.run({ userId, projectId }, async (tx: Tx) => {
      return tx<NoteRow[]>`
        UPDATE notes
        SET deleted_at = null, updated_at = now()
        WHERE id = ${noteId}::uuid AND project_id = ${projectId}::uuid AND deleted_at IS NOT NULL
        RETURNING id, project_id, author_id, title, content_md, content_json, folder_path, is_daily,
                  deleted_at, created_at, updated_at
      `
    })
    if (!rows[0]) throw new NotFoundException({ code: 'note_not_found' })
    this.logger.log({ event: 'note.restored', userId, projectId, noteId })
    return mapNote(rows[0])
  }

  // ── List Deleted ───────────────────────────────────────────────────────────

  async listDeleted(userId: string, projectId: string): Promise<Note[]> {
    const rows = await this.db.run({ userId, projectId }, async (tx: Tx) => {
      return tx<NoteRow[]>`
        SELECT id, project_id, author_id, title, content_md, content_json, folder_path, is_daily,
               deleted_at, created_at, updated_at
        FROM notes
        WHERE project_id = ${projectId}::uuid AND deleted_at IS NOT NULL
        ORDER BY deleted_at DESC
      `
    })
    return rows.map(mapNote)
  }

  // ── Move ───────────────────────────────────────────────────────────────────

  async move(userId: string, projectId: string, noteId: string, newFolderPath: string): Promise<Note> {
    const rows = await this.db.run({ userId, projectId }, async (tx: Tx) => {
      return tx<NoteRow[]>`
        UPDATE notes
        SET folder_path = ${newFolderPath}, updated_at = now()
        WHERE id = ${noteId}::uuid AND project_id = ${projectId}::uuid AND deleted_at IS NULL
        RETURNING id, project_id, author_id, title, content_md, content_json, folder_path, is_daily,
                  deleted_at, created_at, updated_at
      `
    })
    if (!rows[0]) throw new NotFoundException({ code: 'note_not_found' })
    this.logger.log({ event: 'note.moved', userId, projectId, noteId, newFolderPath })
    return mapNote(rows[0])
  }

  // ── Get Backlinks ──────────────────────────────────────────────────────────

  async getBacklinks(userId: string, projectId: string, noteId: string): Promise<Note[]> {
    const rows = await this.db.run({ userId, projectId }, async (tx: Tx) => {
      return tx<NoteRow[]>`
        SELECT n.id, n.project_id, n.author_id, n.title, n.content_md, n.content_json,
               n.folder_path, n.is_daily, n.deleted_at, n.created_at, n.updated_at
        FROM notes n
        INNER JOIN note_links nl ON nl.from_note = n.id
        WHERE nl.to_note = ${noteId}::uuid
          AND n.project_id = ${projectId}::uuid
          AND n.deleted_at IS NULL
        ORDER BY n.created_at DESC
      `
    })
    return rows.map(mapNote)
  }

  // ── Internal: update note_links in-transaction ─────────────────────────────

  private async updateNoteLinksInTx(tx: Tx, noteId: string, projectId: string, contentMd: string): Promise<void> {
    const titles = parseWikilinks(contentMd)

    const resolved = titles.length > 0
      ? await tx<{ id: string }[]>`
          SELECT id FROM notes
          WHERE project_id = ${projectId}::uuid
            AND title = ANY(${titles})
            AND deleted_at IS NULL
        `
      : []

    await tx`DELETE FROM note_links WHERE from_note = ${noteId}::uuid`
    for (const { id: toNoteId } of resolved) {
      if (toNoteId !== noteId) {
        await tx`
          INSERT INTO note_links (from_note, to_note)
          VALUES (${noteId}::uuid, ${toNoteId}::uuid)
          ON CONFLICT DO NOTHING
        `
      }
    }
  }

  // ── Internal: enqueue note.delta with debounce ─────────────────────────────

  private async enqueueNoteDelta(noteId: string, projectId: string, contentMd: string): Promise<void> {
    const DEBOUNCE_KEY = `note_delta_job:${noteId}`

    // Check for existing pending job
    const existingJobId = await this.redis.get(DEBOUNCE_KEY)
    if (existingJobId) {
      try {
        const existingJob = await this.noteDeltaQueue.getJob(existingJobId)
        if (existingJob && (await existingJob.isWaiting())) {
          await existingJob.remove()
        }
      } catch {
        // Job may have already started — safe to ignore
      }
    }

    // Enqueue new job with 5s delay
    const job = await this.noteDeltaQueue.add(
      'note.delta',
      { noteId, projectId, contentMd },
      { delay: DEBOUNCE_DELAY_MS },
    )
    await this.redis.setex(DEBOUNCE_KEY, DEBOUNCE_TTL_SECONDS, job.id!)
  }
}
