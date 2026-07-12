import { vi, describe, it, expect, beforeEach } from 'vitest'

// ── Mocks (must come before any imports that pull in the mocked modules) ────

vi.mock('@bramha/db', () => ({ withTenant: vi.fn() }))
vi.mock('bullmq', () => {
  const jobMock = {
    isWaiting: vi.fn().mockResolvedValue(false),
    remove: vi.fn().mockResolvedValue(undefined),
  }
  const Queue = vi.fn().mockImplementation(() => ({
    add: vi.fn().mockResolvedValue({ id: 'job-1' }),
    getJob: vi.fn().mockResolvedValue(jobMock),
  }))
  return { Queue }
})

// ── Actual imports ────────────────────────────────────────────────────────────

import { BadRequestException, NotFoundException } from '@nestjs/common'
import { NotesService } from './notes.service.js'
import type { RlsDbService } from '../common/db/rls-db.service.js'
import { Queue } from 'bullmq'
import type postgres from 'postgres'

// ── Constants ─────────────────────────────────────────────────────────────────

const USER_ID = '550e8400-e29b-41d4-a716-446655440000'
const PROJECT_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'
const NOTE_ID = '6ba7b810-9dad-11d1-80b4-00c04fd430c8'
const NOTE_ID_2 = '7ba7b810-9dad-11d1-80b4-00c04fd430c8'

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeTx(results: unknown[][]): postgres.TransactionSql {
  let call = 0
  return vi.fn().mockImplementation(
    () => Promise.resolve(results[call++] ?? []),
  ) as unknown as postgres.TransactionSql
}

function makeNoteRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: NOTE_ID,
    project_id: PROJECT_ID,
    author_id: USER_ID,
    title: 'Test Note',
    content_md: '# Hello\n\nSome content here.',
    content_json: null,
    folder_path: '/',
    is_daily: false,
    deleted_at: null,
    created_at: '2024-01-01T00:00:00+00:00',
    updated_at: '2024-01-01T00:00:00+00:00',
    ...overrides,
  }
}

const redisMock = {
  get: vi.fn().mockResolvedValue(null),
  setex: vi.fn().mockResolvedValue('OK'),
}

function buildMocks() {
  const db: Partial<RlsDbService> = { run: vi.fn() }
  return { db }
}

function buildService(mocks: ReturnType<typeof buildMocks>): NotesService {
  return new NotesService(
    mocks.db as RlsDbService,
    redisMock as unknown as import('ioredis').default,
  )
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('NotesService', () => {
  let svc: NotesService
  let mocks: ReturnType<typeof buildMocks>

  beforeEach(() => {
    vi.clearAllMocks()
    redisMock.get.mockResolvedValue(null)
    redisMock.setex.mockResolvedValue('OK')
    mocks = buildMocks()
    svc = buildService(mocks)
  })

  // ── Create ─────────────────────────────────────────────────────────────────

  it('create note → returns Note with id', async () => {
    const noteRow = makeNoteRow()

    // First db.run: INSERT note
    // Second db.run: sync wikilinks (DELETE note_links, no resolved titles)
    vi.mocked(mocks.db.run!)
      .mockImplementationOnce(async (_ctx, fn) => fn(makeTx([[noteRow]])))
      .mockImplementationOnce(async (_ctx, fn) => fn(makeTx([[], []])))

    const result = await svc.create(USER_ID, PROJECT_ID, {
      title: 'Test Note',
      contentMd: '# Hello\n\nSome content here.',
      folderPath: '/',
    })

    expect(result.id).toBe(NOTE_ID)
    expect(result.title).toBe('Test Note')
    expect(result.projectId).toBe(PROJECT_ID)

    const queueInstance = vi.mocked(Queue).mock.results[0]?.value as { add: ReturnType<typeof vi.fn> }
    expect(queueInstance.add).toHaveBeenCalledWith('note.delta', expect.objectContaining({ noteId: NOTE_ID }), expect.objectContaining({ delay: 5000 }))
    expect(redisMock.setex).toHaveBeenCalledWith(`note_delta_job:${NOTE_ID}`, 30, 'job-1')
  })

  // ── Update with wikilinks ──────────────────────────────────────────────────

  it('update with wikilinks → note_links upserted + note.delta enqueued', async () => {
    const updatedContent = 'See [[Other Note]] for details.'
    const noteRow = makeNoteRow({ content_md: updatedContent })

    // First db.run: UPDATE note
    // Second db.run: sync wikilinks (SELECT resolved + DELETE + INSERT link)
    vi.mocked(mocks.db.run!)
      .mockImplementationOnce(async (_ctx, fn) => fn(makeTx([[noteRow]])))
      .mockImplementationOnce(async (_ctx, fn) =>
        fn(makeTx([[{ id: NOTE_ID_2 }], [], []])),
      )

    const result = await svc.update(USER_ID, PROJECT_ID, NOTE_ID, {
      contentMd: updatedContent,
    })

    expect(result.contentMd).toBe(updatedContent)

    const queueInstance = vi.mocked(Queue).mock.results[0]?.value as { add: ReturnType<typeof vi.fn> }
    expect(queueInstance.add).toHaveBeenCalledWith('note.delta', expect.objectContaining({ noteId: NOTE_ID }), expect.any(Object))
  })

  // ── Content injection ──────────────────────────────────────────────────────

  it('update with <script> tag → throws BadRequestException', async () => {
    await expect(
      svc.update(USER_ID, PROJECT_ID, NOTE_ID, {
        contentMd: 'Hello <script>alert("xss")</script>',
      }),
    ).rejects.toMatchObject(
      expect.objectContaining({
        constructor: BadRequestException,
        response: expect.objectContaining({ code: 'content_injection' }),
      }),
    )

    // No db calls should have been made
    expect(mocks.db.run).not.toHaveBeenCalled()
  })

  // ── Soft delete ────────────────────────────────────────────────────────────

  it('soft delete → sets deleted_at; marks knowledge_chunks stale', async () => {
    // Single db.run with two tx calls: UPDATE notes + UPDATE knowledge_chunks
    vi.mocked(mocks.db.run!).mockImplementationOnce(async (_ctx, fn) =>
      fn(makeTx([[{ id: NOTE_ID }], []])),
    )

    await svc.delete(USER_ID, PROJECT_ID, NOTE_ID)

    expect(mocks.db.run).toHaveBeenCalledTimes(1)
  })

  // ── Restore ────────────────────────────────────────────────────────────────

  it('restore → deleted_at = null', async () => {
    const restoredRow = makeNoteRow({ deleted_at: null })
    vi.mocked(mocks.db.run!).mockImplementationOnce(async (_ctx, fn) =>
      fn(makeTx([[restoredRow]])),
    )

    const result = await svc.restore(USER_ID, PROJECT_ID, NOTE_ID)
    expect(result.deletedAt).toBeNull()
  })

  // ── List Deleted ───────────────────────────────────────────────────────────

  it('listDeleted → returns only deleted notes', async () => {
    const deletedRow = makeNoteRow({ deleted_at: '2024-02-01T00:00:00+00:00' })
    vi.mocked(mocks.db.run!).mockImplementationOnce(async (_ctx, fn) =>
      fn(makeTx([[deletedRow]])),
    )

    const result = await svc.listDeleted(USER_ID, PROJECT_ID)
    expect(result).toHaveLength(1)
    expect(result[0]!.deletedAt).toBe('2024-02-01T00:00:00+00:00')
  })

  // ── Backlinks ──────────────────────────────────────────────────────────────

  it('getBacklinks → returns notes linking TO requested note', async () => {
    const backlinkRow = makeNoteRow({ id: NOTE_ID_2, title: 'Linking Note' })
    vi.mocked(mocks.db.run!).mockImplementationOnce(async (_ctx, fn) =>
      fn(makeTx([[backlinkRow]])),
    )

    const result = await svc.getBacklinks(USER_ID, PROJECT_ID, NOTE_ID)
    expect(result).toHaveLength(1)
    expect(result[0]!.id).toBe(NOTE_ID_2)
    expect(result[0]!.title).toBe('Linking Note')
  })

  // ── Debounce ───────────────────────────────────────────────────────────────

  it('debounce: second update removes first job and enqueues fresh one', async () => {
    const noteRow = makeNoteRow({ content_md: 'Updated content.' })

    const queueInstance = vi.mocked(Queue).mock.results[0]?.value as {
      add: ReturnType<typeof vi.fn>
      getJob: ReturnType<typeof vi.fn>
    }

    // Mock an existing job that is still waiting
    const waitingJobMock = {
      isWaiting: vi.fn().mockResolvedValue(true),
      remove: vi.fn().mockResolvedValue(undefined),
    }
    queueInstance.getJob.mockResolvedValue(waitingJobMock)

    // Redis returns existing job id for debounce key
    redisMock.get.mockResolvedValue('existing-job-id')

    vi.mocked(mocks.db.run!)
      .mockImplementationOnce(async (_ctx, fn) => fn(makeTx([[noteRow]])))
      .mockImplementationOnce(async (_ctx, fn) => fn(makeTx([[], []])))

    await svc.update(USER_ID, PROJECT_ID, NOTE_ID, {
      contentMd: 'Updated content.',
    })

    // Existing job was retrieved and removed
    expect(queueInstance.getJob).toHaveBeenCalledWith('existing-job-id')
    expect(waitingJobMock.isWaiting).toHaveBeenCalled()
    expect(waitingJobMock.remove).toHaveBeenCalled()

    // New job was enqueued
    expect(queueInstance.add).toHaveBeenCalledWith('note.delta', expect.any(Object), expect.objectContaining({ delay: 5000 }))

    // Redis key updated with new job id
    expect(redisMock.setex).toHaveBeenCalledWith(`note_delta_job:${NOTE_ID}`, 30, 'job-1')
  })

  // ── NotFoundException ──────────────────────────────────────────────────────

  it('get → throws NotFoundException when note not found', async () => {
    vi.mocked(mocks.db.run!).mockImplementationOnce(async (_ctx, fn) =>
      fn(makeTx([[]])),
    )

    await expect(svc.get(USER_ID, PROJECT_ID, NOTE_ID)).rejects.toMatchObject(
      expect.objectContaining({
        constructor: NotFoundException,
        response: expect.objectContaining({ code: 'note_not_found' }),
      }),
    )
  })
})
