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

  /**
   * Build a Set-Cookie header value for the refresh_token cookie.
   * Sets Secure only outside of development to allow HTTP local testing.
   */
  // buildRefreshCookieHeader(rawToken: string): string {
  //   const maxAge = SESSION_REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60
  //   const secure = process.env['NODE_ENV'] !== 'development' ? '; Secure' : ''
  //   return `refresh_token=${rawToken}; HttpOnly${secure}; SameSite=Lax; Path=/; Max-Age=${maxAge}`
  // }

  // /** Build a Set-Cookie header that immediately expires the refresh_token cookie. */
  // buildClearRefreshCookieHeader(): string {
  //   const secure = process.env['NODE_ENV'] !== 'development' ? '; Secure' : ''
  //   return `refresh_token=; Path=/; HttpOnly${secure}; SameSite=Lax; Max-Age=0`
  // }

  // /**
  //  * Build a Set-Cookie header for the access_token cookie — the web client's
  //  * only auth transport (it never stores the token itself; see JwtAuthGuard's
  //  * cookie fallback). SameSite=Strict: this cookie is only ever needed for
  //  * same-origin fetch() calls, never a cross-site top-level navigation.
  //  */
  // buildAccessCookieHeader(accessToken: string, expiresInSeconds: number): string {
  //   const secure = process.env['NODE_ENV'] !== 'development' ? '; Secure' : ''
  //   return `access_token=${accessToken}; HttpOnly${secure}; SameSite=Strict; Path=/; Max-Age=${expiresInSeconds}`
  // }

  // /** Build a Set-Cookie header that immediately expires the access_token cookie. */
  // buildClearAccessCookieHeader(): string {
  //   const secure = process.env['NODE_ENV'] !== 'development' ? '; Secure' : ''
  //   return `access_token=; Path=/; HttpOnly${secure}; SameSite=Strict; Max-Age=0`
  // }

  buildRefreshCookieHeader(rawToken: string): string {
  const maxAge = SESSION_REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60
  const secure =
    process.env['NODE_ENV'] !== 'development' ? '; Secure' : ''

  return `refresh_token=${rawToken}; HttpOnly${secure}; SameSite=None; Path=/; Max-Age=${maxAge}`
}

buildClearRefreshCookieHeader(): string {
  const secure =
    process.env['NODE_ENV'] !== 'development' ? '; Secure' : ''

  return `refresh_token=; Path=/; HttpOnly${secure}; SameSite=None; Max-Age=0`
}

buildAccessCookieHeader(
  accessToken: string,
  expiresInSeconds: number,
): string {
  const secure =
    process.env['NODE_ENV'] !== 'development' ? '; Secure' : ''

  return `access_token=${accessToken}; HttpOnly${secure}; SameSite=None; Path=/; Max-Age=${expiresInSeconds}`
}

buildClearAccessCookieHeader(): string {
  const secure =
    process.env['NODE_ENV'] !== 'development' ? '; Secure' : ''

  return `access_token=; Path=/; HttpOnly${secure}; SameSite=None; Max-Age=0`
}
}
