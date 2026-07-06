import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common'
import postgres from 'postgres'

export interface UserRow {
  id: string
  email: string
  password_hash: string | null
  display_name: string
  email_verified_at: string | null
  totp_secret_enc: Buffer | null
  status: string
  is_admin: boolean
  created_at: string
  updated_at: string
}

export interface RecoveryCodeRow {
  id: string
  user_id: string
  code_hash: string
  used_at: string | null
  created_at: string
}

export interface SessionRow {
  id: string
  user_id: string
  refresh_token_hash: string
  expires_at: string
  revoked_at: string | null
  rotated_from: string | null
}

@Injectable()
export class AuthDbService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AuthDbService.name)
  private sql!: postgres.Sql

  onModuleInit(): void {
    const url = process.env['DATABASE_URL']
    if (!url) throw new Error('DATABASE_URL environment variable is required')
    this.sql = postgres(url, { max: 5, idle_timeout: 20, connect_timeout: 10 })
    this.logger.log('AuthDbService connected')
  }

  async onModuleDestroy(): Promise<void> {
    await this.sql.end({ timeout: 5 })
  }

  // ── Users ──────────────────────────────────────────────────────────────────

  async findUserByEmail(email: string): Promise<UserRow | null> {
    const rows = await this.sql<UserRow[]>`
      SELECT id, email, password_hash, display_name, email_verified_at,
             totp_secret_enc, status, is_admin, created_at, updated_at
      FROM   users
      WHERE  email = ${email}
    `
    return rows[0] ?? null
  }

  async findUserById(id: string): Promise<UserRow | null> {
    const rows = await this.sql<UserRow[]>`
      SELECT id, email, password_hash, display_name, email_verified_at,
             totp_secret_enc, status, is_admin, created_at, updated_at
      FROM   users
      WHERE  id = ${id}
    `
    return rows[0] ?? null
  }

  async createUser(data: {
    email: string
    passwordHash: string
    displayName: string
  }): Promise<UserRow> {
    const rows = await this.sql<UserRow[]>`
      INSERT INTO users (email, password_hash, display_name)
      VALUES (${data.email}, ${data.passwordHash}, ${data.displayName})
      RETURNING id, email, password_hash, display_name, email_verified_at,
                totp_secret_enc, status, is_admin, created_at, updated_at
    `
    if (!rows[0]) throw new Error('User insert returned no row')
    return rows[0]
  }

  async markEmailVerified(userId: string): Promise<void> {
    await this.sql`
      UPDATE users
      SET    email_verified_at = now(), updated_at = now()
      WHERE  id = ${userId} AND email_verified_at IS NULL
    `
  }

  // ── Email verification tokens ──────────────────────────────────────────────

  async createEmailVerificationToken(data: {
    userId: string
    tokenHash: string
    expiresAt: Date
  }): Promise<void> {
    await this.sql`
      INSERT INTO email_verification_tokens (user_id, token_hash, expires_at)
      VALUES (${data.userId}, ${data.tokenHash}, ${data.expiresAt.toISOString()})
    `
  }

  /**
   * Atomically marks the token as used and returns the owning userId.
   * Returns null if token not found, already used, or expired.
   */
  async findAndConsumeVerificationToken(tokenHash: string): Promise<{ userId: string } | null> {
    const rows = await this.sql<{ user_id: string }[]>`
      UPDATE email_verification_tokens
      SET    used_at = now()
      WHERE  token_hash = ${tokenHash}
        AND  used_at IS NULL
        AND  expires_at > now()
      RETURNING user_id
    `
    const row = rows[0]
    if (!row) return null
    return { userId: row.user_id }
  }

  // ── Sessions ───────────────────────────────────────────────────────────────

  async createSession(data: {
    userId: string
    refreshTokenHash: string
    userAgent: string | null
    ip: string | null
    expiresAt: Date
    rotatedFrom?: string | null
  }): Promise<SessionRow> {
    const rows = await this.sql<SessionRow[]>`
      INSERT INTO auth_sessions
        (user_id, refresh_token_hash, user_agent, ip, expires_at, rotated_from)
      VALUES (
        ${data.userId},
        ${data.refreshTokenHash},
        ${data.userAgent},
        ${data.ip},
        ${data.expiresAt.toISOString()},
        ${data.rotatedFrom ?? null}
      )
      RETURNING id, user_id, refresh_token_hash, expires_at, revoked_at, rotated_from
    `
    if (!rows[0]) throw new Error('Session insert returned no row')
    return rows[0]
  }

  async findSessionByTokenHash(hash: string): Promise<SessionRow | null> {
    const rows = await this.sql<SessionRow[]>`
      SELECT id, user_id, refresh_token_hash, expires_at, revoked_at, rotated_from
      FROM   auth_sessions
      WHERE  refresh_token_hash = ${hash}
    `
    return rows[0] ?? null
  }

  async revokeSession(sessionId: string): Promise<void> {
    await this.sql`
      UPDATE auth_sessions
      SET    revoked_at = now()
      WHERE  id = ${sessionId} AND revoked_at IS NULL
    `
  }

  async revokeAllUserSessions(userId: string): Promise<void> {
    await this.sql`
      UPDATE auth_sessions
      SET    revoked_at = now()
      WHERE  user_id = ${userId} AND revoked_at IS NULL
    `
  }

  // ── TOTP ───────────────────────────────────────────────────────────────────

  async setTotpSecret(userId: string, encryptedSecret: Buffer | null): Promise<void> {
    // postgres.js requires Uint8Array<ArrayBuffer> for bytea params (TS 5.9+ strict)
    const param = encryptedSecret !== null ? new Uint8Array(encryptedSecret) : null
    await this.sql`
      UPDATE users
      SET    totp_secret_enc = ${param}, updated_at = now()
      WHERE  id = ${userId}
    `
  }

  // ── Recovery codes ─────────────────────────────────────────────────────────

  async createRecoveryCodes(
    userId: string,
    codeHashes: string[],
  ): Promise<void> {
    if (codeHashes.length === 0) return
    // Delete existing unused codes first (re-enrollment)
    await this.sql`
      DELETE FROM recovery_codes WHERE user_id = ${userId} AND used_at IS NULL
    `
    // Bulk insert new codes using unnest
    await this.sql`
      INSERT INTO recovery_codes (user_id, code_hash)
      SELECT ${userId}, unnest(${codeHashes}::text[])
    `
  }

  async findUnusedRecoveryCodes(userId: string): Promise<RecoveryCodeRow[]> {
    return this.sql<RecoveryCodeRow[]>`
      SELECT id, user_id, code_hash, used_at, created_at
      FROM   recovery_codes
      WHERE  user_id = ${userId} AND used_at IS NULL
    `
  }

  async markRecoveryCodeUsed(codeId: string): Promise<void> {
    await this.sql`
      UPDATE recovery_codes
      SET    used_at = now()
      WHERE  id = ${codeId} AND used_at IS NULL
    `
  }

  async countUnusedRecoveryCodes(userId: string): Promise<number> {
    const rows = await this.sql<{ count: string }[]>`
      SELECT count(*) AS count
      FROM   recovery_codes
      WHERE  user_id = ${userId} AND used_at IS NULL
    `
    return parseInt(rows[0]?.count ?? '0', 10)
  }

  async deleteRecoveryCodes(userId: string): Promise<void> {
    await this.sql`
      DELETE FROM recovery_codes WHERE user_id = ${userId}
    `
  }

  // ── API keys ───────────────────────────────────────────────────────────────

  async findApiKeyByKeyId(keyId: string): Promise<{
    id: string
    user_id: string
    key_hash: string
    scopes: string[]
    revoked_at: string | null
  } | null> {
    const rows = await this.sql<
      {
        id: string
        user_id: string
        key_hash: string
        scopes: string[]
        revoked_at: string | null
      }[]
    >`
      SELECT id, user_id, key_hash, scopes, revoked_at
      FROM   api_keys
      WHERE  key_id = ${keyId}
      LIMIT  1
    `
    return rows[0] ?? null
  }

  async touchApiKeyLastUsed(id: string): Promise<void> {
    await this.sql`
      UPDATE api_keys SET last_used_at = now() WHERE id = ${id}
    `
  }

  // ── Password reset tokens ──────────────────────────────────────────────────

  async createPasswordResetToken(userId: string, tokenHash: string, expiresAt: Date): Promise<void> {
    await this.sql`
      INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
      VALUES (${userId}, ${tokenHash}, ${expiresAt.toISOString()})
    `
  }

  async findValidPasswordResetToken(tokenHash: string): Promise<{ id: string; userId: string } | null> {
    const rows = await this.sql<{ id: string; user_id: string }[]>`
      SELECT id, user_id
      FROM password_reset_tokens
      WHERE token_hash = ${tokenHash}
        AND expires_at > now()
        AND used_at IS NULL
      LIMIT 1
    `
    const row = rows[0]
    if (!row) return null
    return { id: row.id, userId: row.user_id }
  }

  async markPasswordResetTokenUsed(id: string): Promise<void> {
    await this.sql`
      UPDATE password_reset_tokens SET used_at = now() WHERE id = ${id}
    `
  }

  async updateUserPassword(userId: string, passwordHash: string): Promise<void> {
    await this.sql`
      UPDATE users SET password_hash = ${passwordHash}, updated_at = now()
      WHERE id = ${userId}
    `
  }
}
