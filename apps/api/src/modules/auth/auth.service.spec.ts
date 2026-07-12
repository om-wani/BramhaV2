import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  BadRequestException,
  ConflictException,
  UnauthorizedException,
} from '@nestjs/common'
import { AuthService } from './auth.service.js'
import type { AuthDbService, UserRow, SessionRow } from './auth-db.service.js'
import type { JwtService } from './jwt.service.js'
import type { PasswordService } from './password.service.js'
import type { SessionService } from './session.service.js'

// ── Helpers ─────────────────────────────────────────────────────────────────

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

function makeSessionRow(overrides: Partial<SessionRow> = {}): SessionRow {
  const thirtyDays = new Date()
  thirtyDays.setDate(thirtyDays.getDate() + 30)
  return {
    id: 'session-uuid-1',
    user_id: 'user-uuid-1',
    refresh_token_hash: 'hash-abc',
    expires_at: thirtyDays.toISOString(),
    revoked_at: null,
    rotated_from: null,
    two_factor_verified: false,
    ...overrides,
  }
}

function buildMocks() {
  const authDb: Partial<AuthDbService> = {
    findUserByEmail: vi.fn().mockResolvedValue(null),
    findUserById: vi.fn().mockResolvedValue(null),
    createUser: vi.fn().mockResolvedValue(makeUserRow()),
    markEmailVerified: vi.fn().mockResolvedValue(undefined),
    createEmailVerificationToken: vi.fn().mockResolvedValue(undefined),
    findAndConsumeVerificationToken: vi.fn().mockResolvedValue({ userId: 'user-uuid-1' }),
    createSession: vi.fn().mockResolvedValue(makeSessionRow()),
    findSessionByTokenHash: vi.fn().mockResolvedValue(null),
    revokeSession: vi.fn().mockResolvedValue(undefined),
    revokeAllUserSessions: vi.fn().mockResolvedValue(undefined),
  }

  const jwt: Partial<JwtService> = {
    sign: vi.fn().mockResolvedValue({ accessToken: 'test.access.token', expiresIn: 900 }),
  }

  const password: Partial<PasswordService> = {
    hash: vi.fn().mockResolvedValue('$argon2id$mocked'),
    verify: vi.fn().mockResolvedValue(true),
    checkStrength: vi.fn(),
  }

  const session: Partial<SessionService> = {
    generateToken: vi.fn().mockReturnValue({ raw: 'raw-token', hash: 'hashed-token' }),
    hashToken: vi.fn().mockReturnValue('hashed-token'),
    getRefreshTokenExpiry: vi.fn().mockReturnValue(new Date()),
    getVerificationTokenExpiry: vi.fn().mockReturnValue(new Date()),
  }

  return { authDb, jwt, password, session }
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('AuthService', () => {
  let svc: AuthService
  let mocks: ReturnType<typeof buildMocks>

  beforeEach(async () => {
    mocks = buildMocks()
    svc = new AuthService(
      mocks.authDb as AuthDbService,
      mocks.jwt as JwtService,
      mocks.password as PasswordService,
      mocks.session as SessionService,
    )
    // Initialize sentinel hash (normally done via OnModuleInit)
    await svc.onModuleInit()
  })

  // ── register ──────────────────────────────────────────────────────────────

  describe('register', () => {
    it('throws password_too_weak when checkStrength throws', async () => {
      vi.mocked(mocks.password.checkStrength!).mockImplementation(() => {
        throw new BadRequestException({ code: 'password_too_weak', message: 'Too weak' })
      })
      await expect(
        svc.register({ email: 'a@b.com', password: 'weak', displayName: 'A' }),
      ).rejects.toThrow(BadRequestException)
    })

    it('throws email_already_exists when email already exists', async () => {
      vi.mocked(mocks.authDb.findUserByEmail!).mockResolvedValue(makeUserRow())
      const err = await svc
        .register({ email: 'alice@example.com', password: 'StrongPass99!', displayName: 'A' })
        .catch((e: unknown) => e)
      expect(err).toBeInstanceOf(ConflictException)
      const resp = (err as ConflictException).getResponse() as Record<string, unknown>
      expect(resp['code']).toBe('email_already_exists')
    })

    it('returns userId and verifyToken on success', async () => {
      vi.mocked(mocks.authDb.findUserByEmail!).mockResolvedValue(null)
      const result = await svc.register({
        email: 'new@example.com',
        password: 'StrongPass99!',
        displayName: 'New User',
      })
      expect(result.userId).toBe('user-uuid-1')
      expect(typeof result.verifyToken).toBe('string')
    })
  })

  // ── login ─────────────────────────────────────────────────────────────────

  describe('login', () => {
    it('returns tokens on valid credentials', async () => {
      vi.mocked(mocks.authDb.findUserByEmail!).mockResolvedValue(makeUserRow())
      vi.mocked(mocks.password.verify!).mockResolvedValue(true)
      const result = await svc.login(
        { email: 'alice@example.com', password: 'GoodPass99!' },
        '127.0.0.1',
        'TestAgent',
      )
      if (result.requiresTwoFactor) throw new Error('Expected no requiresTwoFactor')
      expect(result.accessToken).toBe('test.access.token')
      expect(typeof result.rawRefreshToken).toBe('string')
    })

    it('throws invalid_credentials for wrong password (no user enumeration)', async () => {
      vi.mocked(mocks.authDb.findUserByEmail!).mockResolvedValue(makeUserRow())
      vi.mocked(mocks.password.verify!).mockResolvedValue(false)
      const err = await svc
        .login({ email: 'alice@example.com', password: 'WrongPass' }, null, null)
        .catch((e: unknown) => e)
      expect(err).toBeInstanceOf(UnauthorizedException)
      const resp = (err as UnauthorizedException).getResponse() as Record<string, unknown>
      expect(resp['code']).toBe('invalid_credentials')
    })

    it('throws invalid_credentials for unknown email (no user enumeration)', async () => {
      vi.mocked(mocks.authDb.findUserByEmail!).mockResolvedValue(null)
      const err = await svc
        .login({ email: 'unknown@example.com', password: 'AnyPass' }, null, null)
        .catch((e: unknown) => e)
      expect(err).toBeInstanceOf(UnauthorizedException)
      const resp = (err as UnauthorizedException).getResponse() as Record<string, unknown>
      expect(resp['code']).toBe('invalid_credentials')
    })

    it('throws invalid_credentials (with internal account_locked log) after 10 consecutive failed attempts', async () => {
      vi.mocked(mocks.authDb.findUserByEmail!).mockResolvedValue(makeUserRow())
      vi.mocked(mocks.password.verify!).mockResolvedValue(false)
      const loginInput = { email: 'lockme@example.com', password: 'WrongPass' }
      // Exhaust 10 attempts
      for (let i = 0; i < 10; i++) {
        await svc.login(loginInput, null, null).catch(() => {})
      }
      // 11th attempt should throw invalid_credentials (hides account existence from attacker)
      const err = await svc.login(loginInput, null, null).catch((e: unknown) => e)
      expect(err).toBeInstanceOf(UnauthorizedException)
      const resp = (err as UnauthorizedException).getResponse() as Record<string, unknown>
      expect(resp['code']).toBe('invalid_credentials')
    })
  })

  // ── refresh ───────────────────────────────────────────────────────────────

  describe('refresh', () => {
    it('issues new tokens on valid refresh token', async () => {
      vi.mocked(mocks.authDb.findSessionByTokenHash!).mockResolvedValue(makeSessionRow())
      const result = await svc.refresh('valid-raw-token', null, null)
      expect(result.accessToken).toBe('test.access.token')
    })

    it('revokes all sessions on refresh token reuse (family revocation)', async () => {
      const revokedSession = makeSessionRow({ revoked_at: '2024-01-01T00:00:00+00:00' })
      vi.mocked(mocks.authDb.findSessionByTokenHash!).mockResolvedValue(revokedSession)
      const err = await svc.refresh('stale-token', null, null).catch((e: unknown) => e)
      expect(err).toBeInstanceOf(UnauthorizedException)
      const resp = (err as UnauthorizedException).getResponse() as Record<string, unknown>
      expect(resp['code']).toBe('session_revoked')
      expect(mocks.authDb.revokeAllUserSessions).toHaveBeenCalledWith('user-uuid-1')
    })

    it('throws token_invalid for unknown refresh token', async () => {
      vi.mocked(mocks.authDb.findSessionByTokenHash!).mockResolvedValue(null)
      const err = await svc.refresh('unknown-token', null, null).catch((e: unknown) => e)
      expect(err).toBeInstanceOf(UnauthorizedException)
      const resp = (err as UnauthorizedException).getResponse() as Record<string, unknown>
      expect(resp['code']).toBe('token_invalid')
    })

    it('propagates twoFactorVerified=false from session even if user later enables TOTP', async () => {
      // Session was created at login time before TOTP was enrolled (two_factor_verified: false).
      // Separately, the user enrolled TOTP — but that must NOT retroactively mark this
      // session as having completed a 2FA challenge.
      const session = makeSessionRow({ two_factor_verified: false })
      vi.mocked(mocks.authDb.findSessionByTokenHash!).mockResolvedValue(session)
      // findUserById must NOT be consulted for the 2FA state on refresh
      vi.mocked(mocks.authDb.findUserById!).mockResolvedValue(
        makeUserRow({ totp_secret_enc: Buffer.from('enc-secret') }), // TOTP now enabled
      )

      await svc.refresh('valid-raw-token', null, null)

      expect(mocks.jwt.sign).toHaveBeenCalledWith(
        'user-uuid-1',
        expect.objectContaining({ twoFactorVerified: false }),
      )
      // Ensure we're not reading TOTP state from the DB on every refresh
      expect(mocks.authDb.findUserById).not.toHaveBeenCalled()
    })
  })
})
