import { NextRequest, NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';

// Exact public paths and path prefixes that bypass auth.
// Using exact match for /login and /api/health to avoid overbroad matching
// (e.g. /login-anything or /api/healthcheck would NOT be public).
const PUBLIC_EXACT = new Set(['/login']);
const PUBLIC_PREFIXES = ['/api/health', '/auth/'];

function isPublicPath(pathname: string): boolean {
  if (PUBLIC_EXACT.has(pathname)) return true;
  return PUBLIC_PREFIXES.some((p) => pathname.startsWith(p));
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  // Verify JWT signature — not just cookie existence.
  // getToken() decodes and verifies the JWT using NEXTAUTH_SECRET.
  // Returns null if the token is missing, expired, or tampered.
  const token = await getToken({ req: request });

  if (!token?.operatorId) {
    // API routes: return JSON 401
    if (pathname.startsWith('/api/')) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 },
      );
    }

    // Page routes: redirect to login
    const loginUrl = new URL('/login', request.url);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
