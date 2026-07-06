import { Injectable, UnauthorizedException, Logger } from '@nestjs/common'
import { randomBytes } from 'crypto'
import * as argon2 from 'argon2'
import { AuthDbService } from './auth-db.service'
import { JwtService } from './jwt.service'
import { SessionService } from './session.service'
import { TotpService } from './totp.service'
import {
  TOTP_RATE_LIMIT_ATTEMPTS,
  TOTP_RATE_LIMIT_WINDOW_MS,
  RECOVERY_CODE_COUNT,
} from '@bramha/shared'

// ── Recovery code format ────────────────────────────────────────────────────
// 16 random bytes → 32 hex chars → formatted as XXXX-XXXX-XXXX-XXXX (4×8 hex)

function generateRawRecoveryCode(): string {
  const hex = randomBytes(16).toString('hex').toUpperCase()
  return [hex.slice(0, 8), hex.slice(8, 16), hex.slice(16, 24), hex.slice(24, 32)].join('-')
}

@Injectable()
export class TwoFactorService {
  private readonly logger = new Logger(TwoFactorService.name)

  /**
   * In-memory rate limiter for 2FA challenge attempts.
   * NOTE: single process only — replace with Redis before horizontal scaling.
   */
  private readonly challengeAttempts = new Map<string, { count: number; windowStart: number }>()

  constructor(
    private readonly authDb: AuthDbService,
    private readonly jwt: JwtService,
    private readonly session: SessionService,
    private readonly totp: TotpService,
  ) {}

  // ── Rate limiting ───────────────────────────────────────────────────────────

  private checkChallengeRateLimit(userId: string): void {
    const now = Date.now()
    const entry = this.challengeAttempts.get(userId) ?? { count: 0, windowStart: now }
    if (now - entry.windowStart > TOTP_RATE_LIMIT_WINDOW_MS) {
      entry.count = 0
      entry.windowStart = now
    }
    entry.count++
    this.challengeAttempts.set(userId, entry)
    if (entry.count > TOTP_RATE_LIMIT_ATTEMPTS) {
      throw new UnauthorizedException({
        code: 'rate_limit_exceeded',
        message: 'Too many 2FA attempts. Please try again later.',
      })
    }
  }

  private clearChallengeAttempts(userId: string): void {
    this.challengeAttempts.delete(userId)
  }

  // ── Enrollment ──────────────────────────────────────────────────────────────

  /**
   * Begin 2FA enrollment: generate a TOTP secret, sign it in a short-lived JWT,
   * and return the provisioning URI plus the pending token.
   * The secret is carried in the signed JWT — not stored server-side.
   */
  async enroll(userId: string): Promise<{ totpUri: string; pendingToken: string }> {
    const user = await this.authDb.findUserById(userId)
    if (!user) {
      throw new UnauthorizedException({ code: 'invalid_token', message: 'User not found' })
    }
    if (user.totp_secret_enc) {
      throw new UnauthorizedException({
        code: 'two_factor_already_enabled',
        message: '2FA is already enabled',
      })
    }

    const secret = this.totp.generateSecret()
    const totpUri = this.totp.getUri(user.email, secret)
    const pendingToken = await this.jwt.signPendingTotp(userId, secret)

    return { totpUri, pendingToken }
  }

  /**
   * Confirm enrollment: verify the pending JWT to recover the secret,
   * verify the TOTP code against it, then persist the encrypted secret
   * and generate recovery codes.
   * Returns recovery codes (shown ONCE only).
   */
  async confirmEnrollment(
    userId: string,
    pendingToken: string,
    code: string,
  ): Promise<{ recoveryCodes: string[] }> {
    const { secret: pendingSecret } = await this.jwt.verifyPendingTotp(pendingToken, userId)

    const valid = this.totp.verify(pendingSecret, code)
    if (!valid) {
      throw new UnauthorizedException({
        code: 'totp_invalid',
        message: 'Invalid TOTP code',
      })
    }

    // Persist encrypted secret
    const encryptedSecret = this.totp.encrypt(pendingSecret)
    await this.authDb.setTotpSecret(userId, encryptedSecret)

    // Generate recovery codes
    const rawCodes: string[] = []
    const codeHashes: string[] = []

    for (let i = 0; i < RECOVERY_CODE_COUNT; i++) {
      const raw = generateRawRecoveryCode()
      const hash = await argon2.hash(raw, {
        type: argon2.argon2id,
        memoryCost: 19456,
        timeCost: 2,
        parallelism: 1,
      })
      rawCodes.push(raw)
      codeHashes.push(hash)
    }

    await this.authDb.createRecoveryCodes(userId, codeHashes)

    this.logger.log({ userId, event: '2fa_enrolled' }, '2FA enrollment confirmed')
    return { recoveryCodes: rawCodes }
  }

  // ── Disable ─────────────────────────────────────────────────────────────────

  /**
   * Disable 2FA. Requires either a valid TOTP code or a recovery code.
   */
  async disable(userId: string, code: string): Promise<void> {
    this.checkChallengeRateLimit(userId)
    const user = await this.authDb.findUserById(userId)
    if (!user) {
      throw new UnauthorizedException({ code: 'invalid_token', message: 'User not found' })
    }
    if (!user.totp_secret_enc) {
      throw new UnauthorizedException({
        code: 'two_factor_not_enabled',
        message: '2FA is not enabled',
      })
    }

    // Try TOTP code first
    const secret = this.totp.decrypt(user.totp_secret_enc)
    const totpValid = this.totp.verify(secret, code)

    if (!totpValid) {
      // Try recovery code
      const consumed = await this.tryConsumeRecoveryCode(userId, code)
      if (!consumed) {
        throw new UnauthorizedException({
          code: 'totp_invalid',
          message: 'Invalid TOTP or recovery code',
        })
      }
    }

    // Remove TOTP secret and all recovery codes
    await this.authDb.setTotpSecret(userId, null)
    await this.authDb.deleteRecoveryCodes(userId)
    this.logger.log({ userId, event: '2fa_disabled' }, '2FA disabled')
  }

  // ── Challenge ───────────────────────────────────────────────────────────────

  /**
   * Complete login for a 2FA-enabled account.
   * Accepts a pre-auth token and a TOTP code (or recovery code).
   * Issues a full session on success.
   */
  async challenge(
    preAuthToken: string,
    code: string,
    ip: string | null,
    userAgent: string | null,
  ): Promise<{ accessToken: string; expiresIn: number; rawRefreshToken: string }> {
    // Verify pre-auth token
    const { userId } = await this.jwt.verifyPreAuth(preAuthToken)

    // Rate limit per userId
    this.checkChallengeRateLimit(userId)

    const user = await this.authDb.findUserById(userId)
    if (!user || !user.totp_secret_enc) {
      throw new UnauthorizedException({
        code: 'pre_auth_token_invalid',
        message: 'Invalid pre-auth token',
      })
    }

    // Try TOTP code
    const secret = this.totp.decrypt(user.totp_secret_enc)
    const totpValid = this.totp.verify(secret, code)

    if (!totpValid) {
      // Try recovery code
      const consumed = await this.tryConsumeRecoveryCode(userId, code)
      if (!consumed) {
        throw new UnauthorizedException({
          code: 'totp_invalid',
          message: 'Invalid TOTP or recovery code',
        })
      }
    }

    // Success — clear rate limit and issue full session
    this.clearChallengeAttempts(userId)

    const { accessToken, expiresIn } = await this.jwt.sign(userId)
    const { raw: rawRefreshToken, hash: refreshHash } = this.session.generateToken()

    await this.authDb.createSession({
      userId,
      refreshTokenHash: refreshHash,
      userAgent,
      ip,
      expiresAt: this.session.getRefreshTokenExpiry(),
    })

    this.logger.log({ userId, ip, event: '2fa_challenge_success' }, '2FA challenge passed')
    return { accessToken, expiresIn, rawRefreshToken }
  }

  // ── Recovery code status ────────────────────────────────────────────────────

  async getRecoveryStatus(userId: string): Promise<{ codesRemaining: number }> {
    const codesRemaining = await this.authDb.countUnusedRecoveryCodes(userId)
    return { codesRemaining }
  }

  // ── Internal helper ─────────────────────────────────────────────────────────

  /**
   * Try to consume a recovery code for the given user.
   * Returns true if a matching unused code was found and marked used.
   */
  private async tryConsumeRecoveryCode(userId: string, rawCode: string): Promise<boolean> {
    const codes = await this.authDb.findUnusedRecoveryCodes(userId)
    for (const row of codes) {
      const matches = await argon2.verify(row.code_hash, rawCode)
      if (matches) {
        await this.authDb.markRecoveryCodeUsed(row.id)
        this.logger.log({ userId, codeId: row.id, event: 'recovery_code_used' }, 'Recovery code consumed')
        return true
      }
    }
    return false
  }
}
