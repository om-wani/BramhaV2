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

  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');

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

  const response = NextResponse.next();
  response.headers.set('Content-Security-Policy', csp);
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');

  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
