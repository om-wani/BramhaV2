import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common'
import postgres from 'postgres'

export interface UserRow {
  id: string
  email: string
  password_hash: string | null
  display_name: string
  email_verified_at: string | null
  status: string
  is_admin: boolean
  created_at: string
  updated_at: string
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
             status, is_admin, created_at, updated_at
      FROM   users
      WHERE  email = ${email}
    `
    return rows[0] ?? null
  }

  async findUserById(id: string): Promise<UserRow | null> {
    const rows = await this.sql<UserRow[]>`
      SELECT id, email, password_hash, display_name, email_verified_at,
             status, is_admin, created_at, updated_at
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
                status, is_admin, created_at, updated_at
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
}
