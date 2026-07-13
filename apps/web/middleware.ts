import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

const PROTECTED_PREFIX = ['/dashboard', '/settings', '/p/', '/admin']

export function middleware(request: NextRequest) {
  // const nonce = Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString('base64')   //this original
  // below two lines are for vercel deployment
  const randomBytes = crypto.getRandomValues(new Uint8Array(16)) 
  const nonce = btoa(String.fromCharCode(...randomBytes))
  // -----------------------------------------

  const apiUrl =
    process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000'

  const apiOrigin = new URL(apiUrl).origin
  const websocketOrigin = apiOrigin.replace(/^http/, 'ws')
  
  const cspHeader = [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    `style-src 'self' 'unsafe-inline'`,  // Tailwind requires this
    `img-src 'self' data: blob:`,
    `font-src 'self'`,
    `connect-src 'self' ${apiOrigin} ${websocketOrigin}`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `frame-ancestors 'none'`,
    `upgrade-insecure-requests`,
  ].join('; ')

  const isProtected = PROTECTED_PREFIX.some(p => request.nextUrl.pathname.startsWith(p))

  // // Auth gate: check for session cookie; redirect to /login if missing
  // if (isProtected) {
  //   const sessionCookie = request.cookies.get('bramha_session')
  //   if (!sessionCookie) {
  //     const loginUrl = new URL('/login', request.url)
  //     loginUrl.searchParams.set('next', request.nextUrl.pathname)
  //     return NextResponse.redirect(loginUrl)
  //   }
  // }

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
