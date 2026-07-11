import {
  Injectable,
  BadRequestException,
  ConflictException,
  UnauthorizedException,
  OnModuleInit,
  Logger,
} from '@nestjs/common'
import { AuthDbService } from './auth-db.service'
import { JwtService } from './jwt.service'
import { PasswordService } from './password.service'
import { SessionService } from './session.service'
import { ErrorCodes } from '@bramha/shared'
import type { RegisterInput, LoginInput } from '@bramha/shared'

// ── Rate-limit constants ────────────────────────────────────────────────────

const LOCKOUT_ATTEMPTS = 10
const LOCKOUT_WINDOW_MS = 15 * 60 * 1000 // 15 min

const IP_BUCKET_MAX = 20
const IP_BUCKET_WINDOW_MS = 15 * 60 * 1000

// ── AuthService ─────────────────────────────────────────────────────────────

@Injectable()
export class AuthService implements OnModuleInit {
  private readonly logger = new Logger(AuthService.name)

  /**
   * NOTE: In-memory rate limiter — single process only.
   * Replace with Redis INCR + EXPIRE before horizontal scaling.
   */
  private readonly accountAttempts = new Map<string, { count: number; windowStart: number }>()
  private readonly ipAttempts = new Map<string, { count: number; windowStart: number }>()

  /**
   * Sentinel hash used to ensure constant-time response when user not found.
   * Computed on module init so it is warm before the first request.
   */
  private sentinelHash = ''

  constructor(
    private readonly authDb: AuthDbService,
    private readonly jwt: JwtService,
    private readonly password: PasswordService,
    private readonly session: SessionService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.sentinelHash = await this.password.hash('__sentinel_timing_protection__')
  }

  // ── Rate-limit helpers ──────────────────────────────────────────────────

  private checkIpBucket(ip: string): void {
    const now = Date.now()
    const entry = this.ipAttempts.get(ip) ?? { count: 0, windowStart: now }
    if (now - entry.windowStart > IP_BUCKET_WINDOW_MS) {
      entry.count = 0
      entry.windowStart = now
    }
    entry.count++
    this.ipAttempts.set(ip, entry)
    if (entry.count > IP_BUCKET_MAX) {
      throw new UnauthorizedException({
        code: 'rate_limit_exceeded',
        message: 'Too many requests. Please try again later.',
      })
    }
  }

  private checkAccountLocked(email: string, ip: string | null): void {
    const now = Date.now()
    const entry = this.accountAttempts.get(email)
    if (!entry) return
    if (now - entry.windowStart > LOCKOUT_WINDOW_MS) {
      this.accountAttempts.delete(email)
      return
    }
    if (entry.count >= LOCKOUT_ATTEMPTS) {
      this.logger.warn({ event: 'account_locked', email, ip }, 'Account temporarily locked')
      throw new UnauthorizedException({
        code: 'invalid_credentials',
        message: 'Invalid credentials',
      })
    }
  }

  private recordFailedAttempt(email: string): void {
    const now = Date.now()
    const entry = this.accountAttempts.get(email) ?? { count: 0, windowStart: now }
    if (now - entry.windowStart > LOCKOUT_WINDOW_MS) {
      entry.count = 0
      entry.windowStart = now
    }
    entry.count++
    this.accountAttempts.set(email, entry)
  }

  private clearAttempts(email: string): void {
    this.accountAttempts.delete(email)
  }

  // ── Auth operations ─────────────────────────────────────────────────────

  async register(input: RegisterInput): Promise<{ userId: string; verifyToken: string }> {
    // 1. Password strength check (throws password_too_weak if score < 3)
    this.password.checkStrength(input.password)

    // 2. Uniqueness check
    const existing = await this.authDb.findUserByEmail(input.email)
    if (existing) {
      throw new ConflictException({
        code: 'email_already_exists',
        message: 'Email already registered',
      })
    }

    // 3. Hash password and create user
    const passwordHash = await this.password.hash(input.password)
    const user = await this.authDb.createUser({
      email: input.email,
      passwordHash,
      displayName: input.displayName,
    })

    // 4. Create email verification token
    const { raw, hash } = this.session.generateToken()
    await this.authDb.createEmailVerificationToken({
      userId: user.id,
      tokenHash: hash,
      expiresAt: this.session.getVerificationTokenExpiry(),
    })

    // 5. Log verification URL — token is only emitted in development
    const appUrl = process.env['APP_URL'] ?? 'http://localhost:3000'
    const verifyUrl = `${appUrl}/verify-email?token=${raw}`
    if (process.env['NODE_ENV'] === 'development') {
      this.logger.log({ event: 'email_verify_url', verifyUrl, userId: user.id }, 'Email verification URL (dev only)')
    } else {
      this.logger.log({ event: 'email_verification_sent', userId: user.id }, 'Verification email queued')
    }

    return { userId: user.id, verifyToken: raw }
  }

  async verifyEmail(token: string): Promise<void> {
    const hash = this.session.hashToken(token)
    const result = await this.authDb.findAndConsumeVerificationToken(hash)
    if (!result) {
      throw new BadRequestException({
        code: 'token_invalid',
        message: 'Verification token is invalid or has expired',
      })
    }
    await this.authDb.markEmailVerified(result.userId)
    this.logger.log({ userId: result.userId, event: 'email_verified' }, 'Email verified')
  }

  async login(
    input: LoginInput,
    ip: string | null,
    userAgent: string | null,
  ): Promise<
    | { requiresTwoFactor: true; preAuthToken: string }
    | { requiresTwoFactor: false; accessToken: string; expiresIn: number; rawRefreshToken: string }
  > {
    // 1. Rate limiting (IP first, then per-account lockout)
    // Falls back to 'unknown' when IP is unavailable (e.g. misconfigured proxy).
    // All requests sharing the 'unknown' key share the same rate limit bucket.
    const ipKey = ip ?? 'unknown'
    this.checkIpBucket(ipKey)
    this.checkAccountLocked(input.email, ip)

    // 2. Look up user — do NOT short-circuit before argon2 to prevent timing oracle
    const user = await this.authDb.findUserByEmail(input.email)

    if (!user || !user.password_hash) {
      // Run sentinel verify to maintain constant time even for unknown accounts
      await this.password.verify(this.sentinelHash, input.password).catch(() => {})
      this.recordFailedAttempt(input.email)
      this.logger.warn(
        { email: input.email, ip, event: 'login_failed_unknown' },
        'Login failed: unknown email',
      )
      throw new UnauthorizedException({
        code: 'invalid_credentials',
        message: 'Invalid credentials',
      })
    }

    // Suspended users: run password check (constant time), then return generic error
    if (user.status === 'suspended') {
      await this.password.verify(user.password_hash, input.password).catch(() => {})
      this.recordFailedAttempt(input.email)
      this.logger.warn(
        { userId: user.id, ip, event: 'login_failed_suspended' },
        'Login failed: suspended account',
      )
      throw new UnauthorizedException({
        code: 'invalid_credentials',
        message: 'Invalid credentials',
      })
    }

    // 3. Verify password
    const valid = await this.password.verify(user.password_hash, input.password)
    if (!valid) {
      this.recordFailedAttempt(input.email)
      this.logger.warn(
        { userId: user.id, ip, event: 'login_failed_bad_password' },
        'Login failed: wrong password',
      )
      throw new UnauthorizedException({
        code: 'invalid_credentials',
        message: 'Invalid credentials',
      })
    }

    // 4. Email verification gate (checked after password to avoid timing leaks)
    if (!user.email_verified_at) {
      throw new UnauthorizedException({
        code: 'email_unverified',
        message: 'Email address not verified',
        detail: 'Check your inbox and verify your email before logging in',
      })
    }

    // 5. On success: clear failed attempts
    this.clearAttempts(input.email)

    // 5a. Check if 2FA is enabled — if so, return pre-auth token instead of full session
    if (user.totp_secret_enc) {
      const preAuthToken = await this.jwt.signPreAuth(user.id)
      this.logger.log({ userId: user.id, ip, event: 'login_requires_2fa' }, 'Login requires 2FA')
      return { requiresTwoFactor: true as const, preAuthToken }
    }

    // 5b. Issue full session tokens
    const { accessToken, expiresIn } = await this.jwt.sign(user.id)
    const { raw: rawRefreshToken, hash: refreshHash } = this.session.generateToken()

    await this.authDb.createSession({
      userId: user.id,
      refreshTokenHash: refreshHash,
      userAgent,
      ip,
      expiresAt: this.session.getRefreshTokenExpiry(),
    })

    this.logger.log({ userId: user.id, ip, event: 'login_success' }, 'Login successful')
    return { requiresTwoFactor: false, accessToken, expiresIn, rawRefreshToken }
  }

  async refresh(
    rawRefreshToken: string,
    ip: string | null,
    userAgent: string | null,
  ): Promise<{ accessToken: string; expiresIn: number; rawRefreshToken: string }> {
    const hash = this.session.hashToken(rawRefreshToken)
    const existingSession = await this.authDb.findSessionByTokenHash(hash)

    if (!existingSession) {
      throw new UnauthorizedException({ code: 'token_invalid', message: 'Invalid refresh token' })
    }

    // Family reuse detection: revoked token reused → revoke all sessions
    if (existingSession.revoked_at) {
      this.logger.warn(
        { userId: existingSession.user_id, sessionId: existingSession.id, event: 'token_reuse' },
        'Refresh token reuse detected — revoking all sessions for user',
      )
      await this.authDb.revokeAllUserSessions(existingSession.user_id)
      throw new UnauthorizedException({ code: 'session_revoked', message: 'Session revoked' })
    }

    if (new Date(existingSession.expires_at) <= new Date()) {
      throw new UnauthorizedException({ code: 'token_expired', message: 'Refresh token expired' })
    }

    // Rotation: revoke old session, issue new tokens
    await this.authDb.revokeSession(existingSession.id)

    // Preserve 2FA state: if the user has TOTP enabled, the session was established via
    // the 2FA challenge (the only path that creates a session when TOTP is set up).
    const refreshUser = await this.authDb.findUserById(existingSession.user_id)
    const twoFactorVerified = refreshUser?.totp_secret_enc !== null && refreshUser?.totp_secret_enc !== undefined

    const { accessToken, expiresIn } = await this.jwt.sign(existingSession.user_id, { twoFactorVerified })
    const { raw: newRawToken, hash: newHash } = this.session.generateToken()

    await this.authDb.createSession({
      userId: existingSession.user_id,
      refreshTokenHash: newHash,
      userAgent,
      ip,
      expiresAt: this.session.getRefreshTokenExpiry(),
      rotatedFrom: existingSession.id,
    })

    this.logger.log(
      { userId: existingSession.user_id, event: 'token_rotated' },
      'Refresh token rotated',
    )
    return { accessToken, expiresIn, rawRefreshToken: newRawToken }
  }

  async logout(rawRefreshToken: string, userId: string): Promise<void> {
    const hash = this.session.hashToken(rawRefreshToken)
    const session = await this.authDb.findSessionByTokenHash(hash)
    if (session && session.user_id === userId) {
      await this.authDb.revokeSession(session.id)
    }
    this.logger.log({ userId, event: 'logout' }, 'User logged out')
  }

  async forgotPassword(email: string): Promise<void> {
    // Always resolves without error — no enumeration
    const user = await this.authDb.findUserByEmail(email)
    if (!user) return // Silent — don't reveal if email exists

    const { raw: rawToken, hash: tokenHash } = this.session.generateToken()
    const expiresAt = this.session.getPasswordResetTokenExpiry()

    await this.authDb.createPasswordResetToken(user.id, tokenHash, expiresAt)

    // In dev, log the token. In prod, would send email via mailer service.
    if (process.env['NODE_ENV'] === 'development') {
      this.logger.log({ msg: 'password_reset_token', rawToken, userId: user.id }, 'Password reset token (dev only)')
    } else {
      this.logger.log({ event: 'password_reset_requested', userId: user.id }, 'Password reset email queued')
    }
  }

  async resetPassword(token: string, newPassword: string): Promise<void> {
    const tokenHash = this.session.hashToken(token)
    const record = await this.authDb.findValidPasswordResetToken(tokenHash)

    if (!record) {
      throw new UnauthorizedException({
        code: ErrorCodes.PASSWORD_RESET_TOKEN_INVALID,
        message: 'Password reset token is invalid or has expired',
      })
    }

    const passwordHash = await this.password.hash(newPassword)
    await this.authDb.updateUserPassword(record.userId, passwordHash)
    await this.authDb.markPasswordResetTokenUsed(record.id)

    this.logger.log({ userId: record.userId, event: 'password_reset' }, 'Password reset successfully')
  }

  async getMe(userId: string): Promise<{
    id: string
    email: string
    displayName: string
    emailVerifiedAt: string | null
    avatarKey: null
    isAdmin: boolean
    status: string
    createdAt: string
    updatedAt: string
  }> {
    const user = await this.authDb.findUserById(userId)
    if (!user) {
      throw new UnauthorizedException({ code: 'invalid_token', message: 'User not found' })
    }
    return {
      id: user.id,
      email: user.email,
      displayName: user.display_name,
      emailVerifiedAt: user.email_verified_at,
      avatarKey: null,
      isAdmin: user.is_admin,
      status: user.status,
      createdAt: user.created_at,
      updatedAt: user.updated_at,
    }
  }
}
