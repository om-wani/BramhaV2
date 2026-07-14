import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

const PROTECTED_PREFIX = ['/dashboard', '/settings', '/p/', '/admin']

export function middleware(request: NextRequest) {
  // Edge runtime has no Node Buffer — use Web APIs for the CSP nonce.
  const randomBytes = crypto.getRandomValues(new Uint8Array(16))
  const nonce = btoa(String.fromCharCode(...randomBytes))

  // Socket.IO connects directly to the api origin (the /backend proxy can't
  // tunnel a persistent WebSocket), so connect-src must allow it. REST goes
  // through the same-origin /backend proxy, covered by 'self'.
  // NEXT_PUBLIC_WS_URL is the absolute api origin in split deploys; falls back
  // to NEXT_PUBLIC_API_URL when that is itself absolute (local dev).
  const wsUrl = process.env.NEXT_PUBLIC_WS_URL ?? process.env.NEXT_PUBLIC_API_URL
  let wsConnectSrc = ''
  if (wsUrl && /^https?:\/\//.test(wsUrl)) {
    const wsOrigin = new URL(wsUrl).origin
    wsConnectSrc = ` ${wsOrigin} ${wsOrigin.replace(/^http/, 'ws')}`
  }

  const cspHeader = [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    `style-src 'self' 'unsafe-inline'`,  // Tailwind requires this
    `img-src 'self' data: blob:`,
    `font-src 'self'`,
    `connect-src 'self'${wsConnectSrc}`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `frame-ancestors 'none'`,
    `upgrade-insecure-requests`,
  ].join('; ')

  const isProtected = PROTECTED_PREFIX.some(p => request.nextUrl.pathname.startsWith(p))

  // Auth gate. Cookies are first-party to this web origin now (local dev is
  // same-site; split production proxies the api under /backend — see
  // next.config.mjs), so the middleware can read them. Gate on refresh_token,
  // the long-lived session marker (SameSite=Lax) — NOT access_token, which is
  // 15-min TTL and would bounce logged-in users to /login every expiry. A
  // present-but-expired refresh token is caught client-side: api-client's
  // /auth/refresh 401 triggers redirectToLogin.
  if (isProtected && !request.cookies.get('refresh_token')) {
    const loginUrl = new URL('/login', request.url)
    loginUrl.searchParams.set('next', request.nextUrl.pathname)
    return NextResponse.redirect(loginUrl)
  }

  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('x-nonce', nonce)

  const response = NextResponse.next({
    request: { headers: requestHeaders },
  })

  // Always-on security headers
  response.headers.set('X-Content-Type-Options', 'nosniff')
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
  response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
  response.headers.set(
    'Strict-Transport-Security',
    'max-age=63072000; includeSubDomains; preload'
  )

  // /artifact-frame serves sandboxed iframe HTML with its own strict CSP.
  // Applying frame-ancestors 'none' here would prevent embedding on the same
  // origin. Skip the main-app CSP and X-Frame-Options for that path only.
  const isArtifactFrame = request.nextUrl.pathname === '/artifact-frame'
  if (!isArtifactFrame) {
    response.headers.set('Content-Security-Policy', cspHeader)
    response.headers.set('X-Frame-Options', 'DENY')
  }

  return response
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
