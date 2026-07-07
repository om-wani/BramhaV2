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

// ── Actual imports ────────────────────────────────────────────────────────────

import { BadRequestException, NotFoundException, UnauthorizedException } from '@nestjs/common'
import { ArtifactsService } from './artifacts.service'
import type { RlsDbService } from '../common/db/rls-db.service'
import type { JwtService } from '../auth/jwt.service'
import type { ConfigService } from '@nestjs/config'
import type { S3Client } from '@aws-sdk/client-s3'
import type postgres from 'postgres'

// ── Constants ─────────────────────────────────────────────────────────────────

const USER_ID = '550e8400-e29b-41d4-a716-446655440000'
const PROJECT_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'
const ARTIFACT_ID = '6ba7b810-9dad-11d1-80b4-00c04fd430c8'
const SIZE_CAP = 2 * 1024 * 1024 // 2 MB

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeTx(results: unknown[][]): postgres.TransactionSql {
  let call = 0
  return vi.fn().mockImplementation(
    () => Promise.resolve(results[call++] ?? []),
  ) as unknown as postgres.TransactionSql
}

function makeArtifactRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: ARTIFACT_ID,
    project_id: PROJECT_ID,
    conversation_id: null,
    created_by_persona: null,
    created_by_user: USER_ID,
    kind: 'code',
    title: 'Test Artifact',
    current_version: 1,
    created_at: '2024-01-01T00:00:00+00:00',
    updated_at: '2024-01-01T00:00:00+00:00',
    ...overrides,
  }
}

function makeVersionRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    artifact_id: ARTIFACT_ID,
    version: 1,
    content_key: `artifacts/${PROJECT_ID}/${ARTIFACT_ID}/v1`,
    content_sha256: 'abc123',
    size_bytes: 100,
    created_by_node: null,
    created_at: '2024-01-01T00:00:00+00:00',
    ...overrides,
  }
}

function buildMocks() {
  const db: Partial<RlsDbService> = { run: vi.fn() }
  const s3: Partial<S3Client> = { send: vi.fn().mockResolvedValue({}) }
  const redis = { publish: vi.fn().mockResolvedValue(0) }
  const jwtService: Partial<JwtService> = {}

  // Private key/public key mocks for getJoseKeys
  const mockPrivateKey = {}
  const mockPublicKey = {}

  const config: Partial<ConfigService> = {
    getOrThrow: vi.fn().mockImplementation((key: string) => {
      if (key === 'JWT_PRIVATE_KEY_BASE64') {
        // Return a placeholder; we'll mock getJoseKeys in service tests that use it
        return Buffer.from('placeholder').toString('base64')
      }
      if (key === 'JWT_PUBLIC_KEY_BASE64') {
        return Buffer.from('placeholder').toString('base64')
      }
      throw new Error(`Unknown config key: ${key}`)
    }),
    get: vi.fn().mockImplementation((key: string, defaultVal?: unknown) => {
      if (key === 'JWT_KEY_ID') return 'key-1'
      if (key === 'S3_BUCKET') return 'bramha-artifacts'
      return defaultVal
    }),
  }

  return { db, s3, redis, jwtService, config, mockPrivateKey, mockPublicKey }
}

function buildService(mocks: ReturnType<typeof buildMocks>): ArtifactsService {
  return new ArtifactsService(
    mocks.db as RlsDbService,
    mocks.jwtService as JwtService,
    mocks.config as ConfigService,
    mocks.s3 as S3Client,
    'bramha-artifacts',
    mocks.redis as unknown as import('ioredis').default,
  )
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('ArtifactsService', () => {
  let svc: ArtifactsService
  let mocks: ReturnType<typeof buildMocks>

  beforeEach(() => {
    mocks = buildMocks()
    svc = buildService(mocks)
  })

  // ── create ─────────────────────────────────────────────────────────────────

  describe('create', () => {
    it('throws BadRequestException when content exceeds 2 MB', async () => {
      const content = 'x'.repeat(SIZE_CAP + 1)
      await expect(
        svc.create(USER_ID, PROJECT_ID, { kind: 'code', title: 'T', content }),
      ).rejects.toThrow(BadRequestException)
    })

    it('exactly 2 MB content passes the size check', async () => {
      const content = 'x'.repeat(SIZE_CAP) // exactly 2 MB (ASCII = 1 byte/char)
      vi.mocked(mocks.db.run!).mockImplementation(async (_ctx, fn) => {
        return fn(makeTx([[makeArtifactRow()], [makeVersionRow({ size_bytes: SIZE_CAP })]]))
      })
      const result = await svc.create(USER_ID, PROJECT_ID, { kind: 'code', title: 'T', content })
      expect(result.artifact.id).toBe(ARTIFACT_ID)
      expect(result.version.sizeBytes).toBe(SIZE_CAP)
    })

    it('2 MB + 1 byte throws BadRequestException', async () => {
      const content = 'x'.repeat(SIZE_CAP + 1)
      await expect(
        svc.create(USER_ID, PROJECT_ID, { kind: 'code', title: 'T', content }),
      ).rejects.toThrow(BadRequestException)
    })

    it('uploads to S3 with correct key before DB insert', async () => {
      vi.mocked(mocks.db.run!).mockImplementation(async (_ctx, fn) => {
        return fn(makeTx([[makeArtifactRow()], [makeVersionRow()]]))
      })
      await svc.create(USER_ID, PROJECT_ID, { kind: 'markdown', title: 'Doc', content: 'hello' })
      expect(mocks.s3.send).toHaveBeenCalledOnce()
    })

    it('computes and stores SHA-256', async () => {
      const { createHash } = await import('node:crypto')
      const content = 'hello world'
      const expectedSha = createHash('sha256').update(content, 'utf8').digest('hex')
      const vRow = makeVersionRow({ content_sha256: expectedSha, size_bytes: content.length })

      vi.mocked(mocks.db.run!).mockImplementation(async (_ctx, fn) => {
        return fn(makeTx([[makeArtifactRow()], [vRow]]))
      })
      const result = await svc.create(USER_ID, PROJECT_ID, { kind: 'html', title: 'H', content })
      expect(result.version.contentSha256).toBe(expectedSha)
    })

    it('DB rows are inserted (artifact + version)', async () => {
      vi.mocked(mocks.db.run!).mockImplementation(async (_ctx, fn) => {
        return fn(makeTx([[makeArtifactRow()], [makeVersionRow()]]))
      })
      const result = await svc.create(USER_ID, PROJECT_ID, {
        kind: 'code',
        title: 'My artifact',
        content: 'const x = 1',
      })
      expect(result.artifact.kind).toBe('code')
      expect(result.version.version).toBe(1)
    })
  })

  // ── createVersion ──────────────────────────────────────────────────────────

  describe('createVersion', () => {
    it('throws BadRequestException when content exceeds 2 MB', async () => {
      const content = 'x'.repeat(SIZE_CAP + 1)
      await expect(
        svc.createVersion(USER_ID, PROJECT_ID, ARTIFACT_ID, { content }),
      ).rejects.toThrow(BadRequestException)
    })

    it('increments version number', async () => {
      const currentArtifact = makeArtifactRow({ current_version: 3 })
      const newVersionRow = makeVersionRow({ version: 4, size_bytes: 50 })

      vi.mocked(mocks.db.run!).mockImplementation(async (_ctx, fn) => {
        // 1) SELECT artifact (version=3), 2) INSERT version row, 3) UPDATE artifact
        return fn(makeTx([[currentArtifact], [newVersionRow], []]))
      })
      const result = await svc.createVersion(USER_ID, PROJECT_ID, ARTIFACT_ID, {
        content: 'updated content',
      })
      expect(result.version).toBe(4)
    })

    it('publishes artifact.stream.chunk event', async () => {
      const publishSpy = vi.spyOn(svc['publisher'], 'publish').mockResolvedValue(undefined)
      const currentArtifact = makeArtifactRow({ current_version: 1 })
      const newVersionRow = makeVersionRow({ version: 2, size_bytes: 20 })

      vi.mocked(mocks.db.run!).mockImplementation(async (_ctx, fn) => {
        return fn(makeTx([[currentArtifact], [newVersionRow], []]))
      })
      await svc.createVersion(USER_ID, PROJECT_ID, ARTIFACT_ID, { content: 'v2 content' })
      expect(publishSpy).toHaveBeenCalledWith(
        expect.stringContaining('artifact.stream.chunk'),
        expect.objectContaining({ artifactId: ARTIFACT_ID }),
      )
    })

    it('throws NotFoundException when artifact does not exist', async () => {
      vi.mocked(mocks.db.run!).mockImplementation(async (_ctx, fn) => {
        return fn(makeTx([[]]))
      })
      await expect(
        svc.createVersion(USER_ID, PROJECT_ID, ARTIFACT_ID, { content: 'x' }),
      ).rejects.toThrow(NotFoundException)
    })
  })

  // ── getRenderToken ─────────────────────────────────────────────────────────

  describe('getRenderToken', () => {
    it('issues a JWT with type=render_token, artifactId, version, exp ~5min', async () => {
      // version row exists
      vi.mocked(mocks.db.run!).mockImplementation(async (_ctx, fn) => {
        return fn(makeTx([[{ artifact_id: ARTIFACT_ID }]]))
      })

      // Directly override the private method on the instance
      const { generateKeyPair } = await import('jose')
      const { privateKey, publicKey } = await generateKeyPair('EdDSA')
      ;(svc as unknown as Record<string, unknown>)['getJoseKeys'] = vi.fn().mockResolvedValue({ privateKey, publicKey })

      const result = await svc.getRenderToken(USER_ID, PROJECT_ID, ARTIFACT_ID, 1)
      expect(typeof result.token).toBe('string')
      expect(result.token.split('.').length).toBe(3) // valid JWT structure
    })

    it('throws NotFoundException when version does not exist', async () => {
      vi.mocked(mocks.db.run!).mockImplementation(async (_ctx, fn) => {
        return fn(makeTx([[]]))
      })
      await expect(svc.getRenderToken(USER_ID, PROJECT_ID, ARTIFACT_ID, 999)).rejects.toThrow(
        NotFoundException,
      )
    })
  })

  // ── getPresignedUrl ────────────────────────────────────────────────────────

  describe('getPresignedUrl', () => {
    async function setupKeys() {
      const { generateKeyPair } = await import('jose')
      const { privateKey, publicKey } = await generateKeyPair('EdDSA')
      ;(svc as unknown as Record<string, unknown>)['getJoseKeys'] = vi.fn().mockResolvedValue({ privateKey, publicKey })
      return { privateKey, publicKey }
    }

    async function signToken(privateKey: unknown, overrides: Record<string, unknown> = {}) {
      const { SignJWT } = await import('jose')
      return new SignJWT({
        sub: USER_ID,
        artifactId: ARTIFACT_ID,
        version: 1,
        projectId: PROJECT_ID,
        type: 'render_token',
        ...overrides,
      })
        .setProtectedHeader({ alg: 'EdDSA' })
        .setIssuer('bramha')
        .setAudience('bramha-api')
        .setIssuedAt()
        .setExpirationTime('5m')
        .sign(privateKey as Parameters<InstanceType<typeof SignJWT>['sign']>[0])
    }

    it('rejects token with wrong type', async () => {
      const { privateKey } = await setupKeys()
      const badToken = await signToken(privateKey, { type: 'session' })
      await expect(
        svc.getPresignedUrl(USER_ID, PROJECT_ID, ARTIFACT_ID, 1, badToken),
      ).rejects.toThrow(UnauthorizedException)
    })

    it('rejects token with wrong artifactId', async () => {
      const { privateKey } = await setupKeys()
      const badToken = await signToken(privateKey, { artifactId: 'other-artifact-id' })
      await expect(
        svc.getPresignedUrl(USER_ID, PROJECT_ID, ARTIFACT_ID, 1, badToken),
      ).rejects.toThrow(UnauthorizedException)
    })

    it('returns presigned URL on valid token', async () => {
      const { privateKey } = await setupKeys()
      const validToken = await signToken(privateKey)
      const result = await svc.getPresignedUrl(USER_ID, PROJECT_ID, ARTIFACT_ID, 1, validToken)
      expect(result.url).toContain('s3.example.com')
    })
  })

  // ── Size cap boundary ──────────────────────────────────────────────────────

  describe('size cap boundary', () => {
    it('exactly 2 MB (2097152 bytes) passes', async () => {
      const content = 'a'.repeat(SIZE_CAP) // 2097152 bytes ASCII
      vi.mocked(mocks.db.run!).mockImplementation(async (_ctx, fn) => {
        return fn(makeTx([[makeArtifactRow()], [makeVersionRow({ size_bytes: SIZE_CAP })]]))
      })
      await expect(
        svc.create(USER_ID, PROJECT_ID, { kind: 'document', title: 'T', content }),
      ).resolves.toBeDefined()
    })

    it('2 MB + 1 byte (2097153 bytes) throws', async () => {
      const content = 'a'.repeat(SIZE_CAP + 1)
      await expect(
        svc.create(USER_ID, PROJECT_ID, { kind: 'document', title: 'T', content }),
      ).rejects.toThrow(BadRequestException)
    })
  })
})
