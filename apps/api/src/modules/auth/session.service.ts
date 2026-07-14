import { Injectable } from '@nestjs/common'
import { randomBytes, createHash } from 'crypto'
import { SESSION_REFRESH_TOKEN_TTL_DAYS } from '@bramha/shared'

const VERIFY_TOKEN_TTL_HOURS = 1

@Injectable()
export class SessionService {
  /** Generate a cryptographically random token and its SHA-256 hash. */
  generateToken(): { raw: string; hash: string } {
    const raw = randomBytes(32).toString('base64url')
    const hash = createHash('sha256').update(raw).digest('hex')
    return { raw, hash }
  }

  /** Compute SHA-256 hash of a raw token (for lookup). */
  hashToken(raw: string): string {
    return createHash('sha256').update(raw).digest('hex')
  }

  getRefreshTokenExpiry(): Date {
    const d = new Date()
    d.setDate(d.getDate() + SESSION_REFRESH_TOKEN_TTL_DAYS)
    return d
  }

  getVerificationTokenExpiry(): Date {
    const d = new Date()
    d.setHours(d.getHours() + VERIFY_TOKEN_TTL_HOURS)
    return d
  }

  getPasswordResetTokenExpiry(): Date {
    const d = new Date()
    d.setHours(d.getHours() + VERIFY_TOKEN_TTL_HOURS) // 1 hour, same as email verification
    return d
  }

  // Cookies are first-party to the web origin: local dev is same-site (both
  // localhost), and split production (Vercel web / Render api) proxies the api
  // under the web origin via /backend (see next.config.mjs). So SameSite=Lax /
  // Strict apply — NOT SameSite=None, which would make them third-party cookies
  // the browser drops. Secure is omitted only in development for plain-HTTP local.

  /**
   * refresh_token cookie — the long-lived session marker. SameSite=Lax so it is
   * sent on top-level navigations, letting the web middleware gate protected
   * routes on its presence (see apps/web/middleware.ts).
   */
  buildRefreshCookieHeader(rawToken: string): string {
    const maxAge = SESSION_REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60
    const secure = process.env['NODE_ENV'] !== 'development' ? '; Secure' : ''
    return `refresh_token=${rawToken}; HttpOnly${secure}; SameSite=Lax; Path=/; Max-Age=${maxAge}`
  }

  /** Build a Set-Cookie header that immediately expires the refresh_token cookie. */
  buildClearRefreshCookieHeader(): string {
    const secure = process.env['NODE_ENV'] !== 'development' ? '; Secure' : ''
    return `refresh_token=; Path=/; HttpOnly${secure}; SameSite=Lax; Max-Age=0`
  }

  /**
   * access_token cookie — the web client's auth transport (it never stores the
   * token; see JwtAuthGuard's cookie fallback). SameSite=Strict: only ever
   * needed for same-origin fetch() calls, never a cross-site navigation.
   */
  buildAccessCookieHeader(accessToken: string, expiresInSeconds: number): string {
    const secure = process.env['NODE_ENV'] !== 'development' ? '; Secure' : ''
    return `access_token=${accessToken}; HttpOnly${secure}; SameSite=Strict; Path=/; Max-Age=${expiresInSeconds}`
  }

  /** Build a Set-Cookie header that immediately expires the access_token cookie. */
  buildClearAccessCookieHeader(): string {
    const secure = process.env['NODE_ENV'] !== 'development' ? '; Secure' : ''
    return `access_token=; Path=/; HttpOnly${secure}; SameSite=Strict; Max-Age=0`
  }
}
