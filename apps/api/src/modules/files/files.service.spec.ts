import { vi, describe, it, expect, beforeEach } from 'vitest'

// ── Mocks (must come before any imports that pull in the mocked modules) ────

vi.mock('@bramha/db', () => ({ withTenant: vi.fn() }))
vi.mock('@aws-sdk/client-s3', () => {
  const S3Client = vi.fn().mockImplementation(() => ({
    send: vi.fn().mockResolvedValue({}),
  }))
  const PutObjectCommand = vi.fn().mockImplementation((input: unknown) => ({ input }))
  const GetObjectCommand = vi.fn().mockImplementation((input: unknown) => ({ input }))
  return { S3Client, PutObjectCommand, GetObjectCommand }
})
vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn().mockResolvedValue('https://s3.example.com/presigned?sig=abc'),
}))
vi.mock('bullmq', () => {
  const Queue = vi.fn().mockImplementation(() => ({
    add: vi.fn().mockResolvedValue({ id: 'job-1' }),
  }))
  return { Queue }
})

// ── Actual imports ────────────────────────────────────────────────────────────

import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  HttpStatus,
} from '@nestjs/common'
import { FilesService } from './files.service'
import type { RlsDbService } from '../common/db/rls-db.service'
import type { ConfigService } from '@nestjs/config'
import type { S3Client } from '@aws-sdk/client-s3'
import { Queue } from 'bullmq'
import type postgres from 'postgres'

// ── Constants ─────────────────────────────────────────────────────────────────

const USER_ID = '550e8400-e29b-41d4-a716-446655440000'
const PROJECT_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'
const FILE_ID = '6ba7b810-9dad-11d1-80b4-00c04fd430c8'

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeTx(results: unknown[][]): postgres.TransactionSql {
  let call = 0
  return vi.fn().mockImplementation(
    () => Promise.resolve(results[call++] ?? []),
  ) as unknown as postgres.TransactionSql
}

function makeFileRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: FILE_ID,
    project_id: PROJECT_ID,
    uploaded_by: USER_ID,
    room_id: null,
    name: 'document.pdf',
    declared_mime: 'application/pdf',
    detected_mime: null,
    size_bytes: '1024',
    storage_key: `staging/${PROJECT_ID}/${FILE_ID}`,
    scan_status: 'clean',
    scan_report: null,
    created_at: '2024-01-01T00:00:00+00:00',
    updated_at: '2024-01-01T00:00:00+00:00',
    ...overrides,
  }
}

function buildMocks() {
  const db: Partial<RlsDbService> = { run: vi.fn() }
  const s3: Partial<S3Client> = { send: vi.fn().mockResolvedValue({}) }
  const redis = {
    incr: vi.fn().mockResolvedValue(1),
    expireat: vi.fn().mockResolvedValue(1),
    publish: vi.fn().mockResolvedValue(0),
  }
  const config: Partial<ConfigService> = {
    get: vi.fn().mockImplementation((key: string, defaultVal?: unknown) => {
      if (key === 'MAX_PROJECT_STORAGE_MB') return 500
      return defaultVal
    }),
    getOrThrow: vi.fn(),
  }

  return { db, s3, redis, config }
}

function buildService(mocks: ReturnType<typeof buildMocks>): FilesService {
  return new FilesService(
    mocks.db as RlsDbService,
    mocks.config as ConfigService,
    mocks.s3 as S3Client,
    'bramha-files',
    mocks.redis as unknown as import('ioredis').default,
  )
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('FilesService', () => {
  let svc: FilesService
  let mocks: ReturnType<typeof buildMocks>

  beforeEach(() => {
    vi.clearAllMocks()
    mocks = buildMocks()
    svc = buildService(mocks)
  })

  // ── MIME allowlist ─────────────────────────────────────────────────────────

  describe('initiateUpload — MIME allowlist', () => {
    it('throws BadRequestException with code mime_not_allowed for disallowed MIME', async () => {
      await expect(
        svc.initiateUpload(USER_ID, PROJECT_ID, {
          name: 'evil.exe',
          declaredMime: 'application/x-executable',
          sizeBytes: 1024,
        }),
      ).rejects.toMatchObject(
        expect.objectContaining({
          constructor: BadRequestException,
          response: expect.objectContaining({ code: 'mime_not_allowed' }),
        }),
      )
    })
  })

  // ── Extension allowlist ────────────────────────────────────────────────────

  describe('initiateUpload — extension allowlist', () => {
    it('throws BadRequestException with code extension_not_allowed for .exe files', async () => {
      await expect(
        svc.initiateUpload(USER_ID, PROJECT_ID, {
          name: 'malware.exe',
          declaredMime: 'application/pdf', // allowed MIME but bad ext
          sizeBytes: 1024,
        }),
      ).rejects.toMatchObject(
        expect.objectContaining({
          constructor: BadRequestException,
          response: expect.objectContaining({ code: 'extension_not_allowed' }),
        }),
      )
    })
  })

  // ── Rate limit ─────────────────────────────────────────────────────────────

  describe('initiateUpload — rate limiting', () => {
    it('throws 429 when user exceeds 10 uploads per hour', async () => {
      mocks.redis.incr = vi.fn().mockResolvedValue(11)

      await expect(
        svc.initiateUpload(USER_ID, PROJECT_ID, {
          name: 'doc.pdf',
          declaredMime: 'application/pdf',
          sizeBytes: 1024,
        }),
      ).rejects.toMatchObject(
        expect.objectContaining({
          status: HttpStatus.TOO_MANY_REQUESTS,
          response: expect.objectContaining({ code: 'rate_limit_exceeded' }),
        }),
      )
    })
  })

  // ── Quota exceeded ─────────────────────────────────────────────────────────

  describe('initiateUpload — project quota', () => {
    it('throws BadRequestException with code project_quota_exceeded when quota is full', async () => {
      // Used = 500 MB exactly (quota is 500 MB), and file adds 1 byte → over limit
      const usedBytes = 500 * 1024 * 1024
      vi.mocked(mocks.db.run!).mockImplementation(async (_ctx, fn) => {
        return fn(makeTx([[{ total: String(usedBytes) }]]))
      })

      await expect(
        svc.initiateUpload(USER_ID, PROJECT_ID, {
          name: 'doc.pdf',
          declaredMime: 'application/pdf',
          sizeBytes: 1,
        }),
      ).rejects.toMatchObject(
        expect.objectContaining({
          constructor: BadRequestException,
          response: expect.objectContaining({ code: 'project_quota_exceeded' }),
        }),
      )
    })
  })

  // ── Success ────────────────────────────────────────────────────────────────

  describe('initiateUpload — success', () => {
    it('calls S3 getSignedUrl with correct key format staging/projectId/fileId and expiresIn=60', async () => {
      const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner')

      // Quota check returns 0 used; insert returns empty (no RETURNING clause)
      vi.mocked(mocks.db.run!)
        .mockImplementationOnce(async (_ctx, fn) => fn(makeTx([[{ total: '0' }]])))
        .mockImplementationOnce(async (_ctx, fn) => fn(makeTx([[]])))

      const result = await svc.initiateUpload(USER_ID, PROJECT_ID, {
        name: 'report.pdf',
        declaredMime: 'application/pdf',
        sizeBytes: 1024,
      })

      expect(result.uploadUrl).toBe('https://s3.example.com/presigned?sig=abc')
      expect(result.key).toMatch(new RegExp(`^staging/${PROJECT_ID}/`))
      expect(result.fileId).toBeTruthy()
      expect(result.expiresAt).toBeTruthy()

      // Verify getSignedUrl was called with expiresIn=60
      expect(getSignedUrl).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.objectContaining({ expiresIn: 60 }),
      )

      // Verify PutObjectCommand was called with ContentType and ContentLength
      const { PutObjectCommand } = await import('@aws-sdk/client-s3')
      expect(PutObjectCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          ContentType: 'application/pdf',
          ContentLength: 1024,
          Key: expect.stringMatching(new RegExp(`^staging/${PROJECT_ID}/`)),
        }),
      )
    })
  })

  // ── confirmUpload ──────────────────────────────────────────────────────────

  describe('confirmUpload', () => {
    it('enqueues BullMQ ingest.file job with fileId, projectId, storageKey', async () => {
      const storageKey = `staging/${PROJECT_ID}/${FILE_ID}`
      const fileRow = makeFileRow({ scan_status: 'pending', storage_key: storageKey })
      const updatedRow = makeFileRow({ scan_status: 'scanning', storage_key: storageKey })

      vi.mocked(mocks.db.run!)
        .mockImplementationOnce(async (_ctx, fn) => fn(makeTx([[fileRow]])))
        .mockImplementationOnce(async (_ctx, fn) => fn(makeTx([[updatedRow]])))

      const result = await svc.confirmUpload(USER_ID, PROJECT_ID, FILE_ID)

      // BullMQ queue.add called with correct args
      const queueInstance = vi.mocked(Queue).mock.results[0]?.value as { add: ReturnType<typeof vi.fn> }
      expect(queueInstance.add).toHaveBeenCalledWith('ingest.file', {
        fileId: FILE_ID,
        projectId: PROJECT_ID,
        storageKey,
      })

      // scan_status updated to scanning
      expect(result.scanStatus).toBe('scanning')
    })

    it('throws NotFoundException when file not found', async () => {
      vi.mocked(mocks.db.run!).mockImplementationOnce(async (_ctx, fn) => fn(makeTx([[]])))

      await expect(
        svc.confirmUpload(USER_ID, PROJECT_ID, FILE_ID),
      ).rejects.toThrow(NotFoundException)
    })
  })

  // ── getDownloadUrl ─────────────────────────────────────────────────────────

  describe('getDownloadUrl', () => {
    it('throws ForbiddenException for quarantined files', async () => {
      vi.mocked(mocks.db.run!).mockImplementation(async (_ctx, fn) =>
        fn(makeTx([[makeFileRow({ scan_status: 'quarantined' })]]))
      )

      await expect(
        svc.getDownloadUrl(USER_ID, PROJECT_ID, FILE_ID),
      ).rejects.toMatchObject(
        expect.objectContaining({
          constructor: ForbiddenException,
          response: expect.objectContaining({ code: 'file_not_clean' }),
        }),
      )
    })

    it('returns presigned URL for clean files', async () => {
      const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner')

      vi.mocked(mocks.db.run!).mockImplementation(async (_ctx, fn) =>
        fn(makeTx([[makeFileRow({ scan_status: 'clean' })]]))
      )

      const result = await svc.getDownloadUrl(USER_ID, PROJECT_ID, FILE_ID)
      expect(result.url).toContain('s3.example.com')
      expect(getSignedUrl).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.objectContaining({ expiresIn: 15 * 60 }),
      )
    })
  })
})
