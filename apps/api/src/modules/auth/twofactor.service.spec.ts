import { describe, it, expect, beforeEach, vi } from 'vitest'
import { UnauthorizedException } from '@nestjs/common'
import { randomBytes } from 'crypto'
import { generateSync } from 'otplib'
import { TwoFactorService } from './twofactor.service.js'
import { TotpService } from './totp.service.js'
import type { AuthDbService, UserRow, RecoveryCodeRow } from './auth-db.service.js'
import type { JwtService } from './jwt.service.js'
import type { SessionService } from './session.service.js'

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeTotpService(): TotpService {
  const masterKey = randomBytes(32).toString('base64')
  process.env['MASTER_KEY'] = masterKey
  const svc = new TotpService()
  svc.onModuleInit()
  return svc
}

function makeUserRow(overrides: Partial<UserRow> = {}): UserRow {
  return {
    id: 'user-uuid-1',
    email: 'alice@example.com',
    password_hash: '$argon2id$v=19$m=19456,t=2,p=1$hash',
    display_name: 'Alice',
    email_verified_at: '2024-01-01T00:00:00+00:00',
    totp_secret_enc: null,
    status: 'active',
    is_admin: false,
    created_at: '2024-01-01T00:00:00+00:00',
    updated_at: '2024-01-01T00:00:00+00:00',
    ...overrides,
  }
}

/** Minimal stateful Redis double — INCR/GET/DEL against an in-memory map, close
 *  enough to real semantics for the rate-limit test to accumulate state across
 *  calls the way the real Lua-backed counter does. */
function makeFakeRedis() {
  const counters = new Map<string, number>()
  return {
    eval: vi.fn(async (_script: string, _numKeys: number, key: string) => {
      const next = (counters.get(key) ?? 0) + 1
      counters.set(key, next)
      return next
    }),
    get: vi.fn(async (key: string) => {
      const v = counters.get(key)
      return v === undefined ? null : String(v)
    }),
    del: vi.fn(async (key: string) => {
      counters.delete(key)
      return 1
    }),
  }
}

function buildMocks() {
  const authDb: Partial<AuthDbService> = {
    findUserById: vi.fn().mockResolvedValue(makeUserRow()),
    setTotpSecret: vi.fn().mockResolvedValue(undefined),
    createRecoveryCodes: vi.fn().mockResolvedValue(undefined),
    deleteRecoveryCodes: vi.fn().mockResolvedValue(undefined),
    findUnusedRecoveryCodes: vi.fn().mockResolvedValue([]),
    markRecoveryCodeUsed: vi.fn().mockResolvedValue(undefined),
    countUnusedRecoveryCodes: vi.fn().mockResolvedValue(7),
    createSession: vi.fn().mockResolvedValue({ id: 'sess-1', user_id: 'user-uuid-1' }),
  }

  const jwt: Partial<JwtService> = {
    sign: vi.fn().mockResolvedValue({ accessToken: 'test.access.token', expiresIn: 900 }),
    signPreAuth: vi.fn().mockResolvedValue('pre.auth.token'),
    verifyPreAuth: vi.fn().mockResolvedValue({ userId: 'user-uuid-1' }),
    signPendingTotp: vi.fn().mockResolvedValue('fake.pending.token'),
    verifyPendingTotp: vi.fn().mockResolvedValue({ secret: 'PLACEHOLDER_SECRET' }),
  }

  const session: Partial<SessionService> = {
    generateToken: vi.fn().mockReturnValue({ raw: 'raw-refresh', hash: 'hashed-refresh' }),
    getRefreshTokenExpiry: vi.fn().mockReturnValue(new Date()),
  }

  const redis = makeFakeRedis()

  return { authDb, jwt, session, redis }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('TwoFactorService', () => {
  let totpSvc: TotpService
  let svc: TwoFactorService
  let mocks: ReturnType<typeof buildMocks>

  beforeEach(() => {
    totpSvc = makeTotpService()
    mocks = buildMocks()
    svc = new TwoFactorService(
      mocks.authDb as AuthDbService,
      mocks.jwt as JwtService,
      mocks.session as SessionService,
      totpSvc,
      mocks.redis as unknown as import('ioredis').default,
    )
  })

  // ── enroll ─────────────────────────────────────────────────────────────────

  describe('enroll', () => {
    it('returns a totpUri and pendingToken and does NOT persist the secret', async () => {
      vi.mocked(mocks.authDb.findUserById!).mockResolvedValue(makeUserRow({ totp_secret_enc: null }))

      const result = await svc.enroll('user-uuid-1')

      expect(result.totpUri).toMatch(/^otpauth:\/\/totp\//)
      expect(result.totpUri).toContain('BramhaV2')
      expect(typeof result.pendingToken).toBe('string')
      expect(result.pendingToken.length).toBeGreaterThan(0)

      // setTotpSecret must NOT have been called during enrollment
      expect(mocks.authDb.setTotpSecret).not.toHaveBeenCalled()
    })

    it('throws two_factor_already_enabled if 2FA is already active', async () => {
      const encSecret = totpSvc.encrypt(totpSvc.generateSecret())
      vi.mocked(mocks.authDb.findUserById!).mockResolvedValue(
        makeUserRow({ totp_secret_enc: encSecret }),
      )

      const err = await svc.enroll('user-uuid-1').catch((e: unknown) => e)
      expect(err).toBeInstanceOf(UnauthorizedException)
      const resp = (err as UnauthorizedException).getResponse() as Record<string, unknown>
      expect(resp['code']).toBe('two_factor_already_enabled')
    })
  })

  // ── confirmEnrollment ──────────────────────────────────────────────────────

  describe('confirmEnrollment', () => {
    it('stores encrypted secret and returns 10 recovery codes on valid code', async () => {
      const secret = totpSvc.generateSecret()
      const code = generateSync({ secret })

      // Make verifyPendingTotp return the actual secret for this test
      vi.mocked(mocks.jwt.verifyPendingTotp!).mockResolvedValue({ secret })

      const result = await svc.confirmEnrollment('user-uuid-1', 'fake.pending.token', code)

      expect(result.recoveryCodes).toHaveLength(10)
      // Each code should match the XXXX-XXXX-XXXX-XXXX format
      for (const rc of result.recoveryCodes) {
        expect(rc).toMatch(/^[0-9A-F]{8}-[0-9A-F]{8}-[0-9A-F]{8}-[0-9A-F]{8}$/)
      }

      expect(mocks.authDb.setTotpSecret).toHaveBeenCalledWith(
        'user-uuid-1',
        expect.any(Buffer),
      )
      expect(mocks.authDb.createRecoveryCodes).toHaveBeenCalledWith(
        'user-uuid-1',
        expect.arrayContaining([expect.any(String)]),
      )
    })

    it('throws totp_invalid for an invalid code', async () => {
      const secret = totpSvc.generateSecret()

      // Make verifyPendingTotp return the actual secret for this test
      vi.mocked(mocks.jwt.verifyPendingTotp!).mockResolvedValue({ secret })

      const err = await svc.confirmEnrollment('user-uuid-1', 'fake.pending.token', '000000').catch((e: unknown) => e)
      expect(err).toBeInstanceOf(UnauthorizedException)
      const resp = (err as UnauthorizedException).getResponse() as Record<string, unknown>
      expect(resp['code']).toBe('totp_invalid')

      // Secret must NOT have been persisted
      expect(mocks.authDb.setTotpSecret).not.toHaveBeenCalled()
    })
  })

  // ── challenge ──────────────────────────────────────────────────────────────

  describe('challenge', () => {
    it('issues full session on valid TOTP code', async () => {
      const secret = totpSvc.generateSecret()
      const encSecret = totpSvc.encrypt(secret)
      vi.mocked(mocks.authDb.findUserById!).mockResolvedValue(
        makeUserRow({ totp_secret_enc: encSecret }),
      )
      vi.mocked(mocks.jwt.verifyPreAuth!).mockResolvedValue({ userId: 'user-uuid-1' })

      const code = generateSync({ secret })
      const result = await svc.challenge('pre.auth.token', code, null, null)

      expect(result.accessToken).toBe('test.access.token')
      expect(result.expiresIn).toBe(900)
      expect(typeof result.rawRefreshToken).toBe('string')
    })

    it('throws rate_limit_exceeded after 5 failed attempts', async () => {
      const secret = totpSvc.generateSecret()
      const encSecret = totpSvc.encrypt(secret)
      vi.mocked(mocks.authDb.findUserById!).mockResolvedValue(
        makeUserRow({ totp_secret_enc: encSecret }),
      )

      // Exhaust 5 attempts with an invalid code
      for (let i = 0; i < 5; i++) {
        await svc.challenge('pre.auth.token', '000000', null, null).catch(() => {})
      }

      // 6th attempt should be rate-limited
      const err = await svc.challenge('pre.auth.token', '000000', null, null).catch((e: unknown) => e)
      expect(err).toBeInstanceOf(UnauthorizedException)
      const resp = (err as UnauthorizedException).getResponse() as Record<string, unknown>
      expect(resp['code']).toBe('rate_limit_exceeded')
    })

    it('accepts a valid recovery code and marks it used', async () => {
      const secret = totpSvc.generateSecret()
      const encSecret = totpSvc.encrypt(secret)
      vi.mocked(mocks.authDb.findUserById!).mockResolvedValue(
        makeUserRow({ totp_secret_enc: encSecret }),
      )

      // Generate a real recovery code and its argon2 hash
      const rawCode = 'AABBCCDD-11223344-EEFF0011-22334455'
      const argon2 = await import('argon2')
      const hash = await argon2.hash(rawCode, {
        type: argon2.argon2id,
        memoryCost: 19456,
        timeCost: 2,
        parallelism: 1,
      })

      const recoveryRow: RecoveryCodeRow = {
        id: 'rc-uuid-1',
        user_id: 'user-uuid-1',
        code_hash: hash,
        used_at: null,
        created_at: '2024-01-01T00:00:00+00:00',
      }
      vi.mocked(mocks.authDb.findUnusedRecoveryCodes!).mockResolvedValue([recoveryRow])

      const result = await svc.challenge('pre.auth.token', rawCode, null, null)
      expect(result.accessToken).toBe('test.access.token')
      expect(mocks.authDb.markRecoveryCodeUsed).toHaveBeenCalledWith('rc-uuid-1')
    })

    it('rejects a reused (already consumed) recovery code', async () => {
      const secret = totpSvc.generateSecret()
      const encSecret = totpSvc.encrypt(secret)
      vi.mocked(mocks.authDb.findUserById!).mockResolvedValue(
        makeUserRow({ totp_secret_enc: encSecret }),
      )
      // No unused recovery codes available — simulates a reused code
      vi.mocked(mocks.authDb.findUnusedRecoveryCodes!).mockResolvedValue([])

      const err = await svc
        .challenge('pre.auth.token', 'AABBCCDD-11223344-EEFF0011-22334455', null, null)
        .catch((e: unknown) => e)
      expect(err).toBeInstanceOf(UnauthorizedException)
      const resp = (err as UnauthorizedException).getResponse() as Record<string, unknown>
      expect(resp['code']).toBe('totp_invalid')
    })
  })

  // ── getRecoveryStatus ──────────────────────────────────────────────────────

  describe('getRecoveryStatus', () => {
    it('returns remaining code count without exposing raw codes', async () => {
      vi.mocked(mocks.authDb.countUnusedRecoveryCodes!).mockResolvedValue(7)
      const result = await svc.getRecoveryStatus('user-uuid-1')
      expect(result).toEqual({ codesRemaining: 7 })
    })
  })
})
