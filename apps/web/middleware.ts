import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const PROTECTED_PREFIXES = ['/dashboard', '/settings', '/p/'];
const SESSION_COOKIE = 'bramha_session';

function isProtected(pathname: string): boolean {
  return PROTECTED_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

function safeRedirect(next: string | null): string {
  if (next !== null && next.startsWith('/') && !next.startsWith('//')) {
    return next;
  }
  return '/dashboard';
}

export function middleware(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;

  // btoa + crypto.randomUUID are Edge runtime globals; Buffer is not
  const nonce = btoa(crypto.randomUUID());

  const csp = [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}'`,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data: blob:`,
    `connect-src 'self' ws: wss:`,
    `font-src 'self'`,
    `frame-ancestors 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    ...(process.env.NODE_ENV === 'production' ? ['upgrade-insecure-requests'] : []),
  ].join('; ');

  if (isProtected(pathname)) {
    const session = request.cookies.get(SESSION_COOKIE);
    if (!session) {
      const loginUrl = new URL('/login', request.url);
      const next = pathname;
      if (next !== '/login' && next !== '/register') {
        loginUrl.searchParams.set('next', next);
      }
      return NextResponse.redirect(loginUrl);
    }
  }

  if (pathname === '/login' || pathname === '/register') {
    const session = request.cookies.get(SESSION_COOKIE);
    if (session) {
      const nextParam = request.nextUrl.searchParams.get('next');
      const dest = safeRedirect(nextParam);
      return NextResponse.redirect(new URL(dest, request.url));
    }
  }

  // Forward nonce to root layout via request header so server components can read it
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('Content-Security-Policy', csp);
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');

  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
