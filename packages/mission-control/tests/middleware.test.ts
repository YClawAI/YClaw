import { NextRequest } from 'next/server';
import { describe, expect, it, vi, beforeEach } from 'vitest';

// Mock next-auth/jwt's getToken — must be before middleware import
const mockGetToken = vi.fn();
vi.mock('next-auth/jwt', () => ({
  getToken: (...args: unknown[]) => mockGetToken(...args),
}));

const { middleware } = await import('../middleware.js');

// NextResponse.next() sets this header to signal passthrough.
const NEXT_HEADER = 'x-middleware-next';

function makeRequest(pathname: string) {
  const url = `http://localhost:3001${pathname}`;
  return new NextRequest(url);
}

describe('middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('public paths', () => {
    it.each([
      '/login',
      '/api/health',
      '/api/health/status',
      '/auth/signin',
      '/auth/callback/credentials',
      '/auth/session',
    ])('passes through %s without authentication', async (path) => {
      const res = await middleware(makeRequest(path));
      expect(res.headers.get(NEXT_HEADER)).toBe('1');
      expect(mockGetToken).not.toHaveBeenCalled();
    });

    it('does NOT treat /login-other as public (exact match)', async () => {
      mockGetToken.mockResolvedValue(null);
      const res = await middleware(makeRequest('/login-other'));
      expect(res.status).toBe(307);
    });

    it('does NOT treat /authz as public (prefix requires trailing slash)', async () => {
      mockGetToken.mockResolvedValue(null);
      const res = await middleware(makeRequest('/authz'));
      // /authz is a page route (not /api/), so gets a redirect, not 401
      expect(res.status).toBe(307);
    });
  });

  describe('authenticated requests (valid JWT)', () => {
    it('passes through when JWT has operatorId', async () => {
      mockGetToken.mockResolvedValue({
        operatorId: 'op_test',
        tier: 'contributor',
        departments: ['marketing'],
      });
      const res = await middleware(makeRequest('/dashboard'));
      expect(res.headers.get(NEXT_HEADER)).toBe('1');
    });
  });

  describe('unauthenticated (no/invalid JWT)', () => {
    it('redirects page routes to /login when JWT is null', async () => {
      mockGetToken.mockResolvedValue(null);
      const res = await middleware(makeRequest('/dashboard'));
      expect(res.status).toBe(307);
      expect(res.headers.get('location')).toContain('/login');
    });

    it('returns 401 JSON for API routes when JWT is null', async () => {
      mockGetToken.mockResolvedValue(null);
      const res = await middleware(makeRequest('/api/agents'));
      expect(res.status).toBe(401);
      const body = await res.json() as { error: string };
      expect(body.error).toBe('Unauthorized');
    });

    it('rejects JWT without operatorId claim', async () => {
      mockGetToken.mockResolvedValue({ sub: 'some-user' }); // no operatorId
      const res = await middleware(makeRequest('/dashboard'));
      expect(res.status).toBe(307);
    });

    it('rejects request with fabricated cookie (getToken returns null)', async () => {
      mockGetToken.mockResolvedValue(null);
      const res = await middleware(makeRequest('/api/operators'));
      expect(res.status).toBe(401);
    });
  });

  describe('legacy mc_api_key cookie', () => {
    it('is no longer accepted', async () => {
      mockGetToken.mockResolvedValue(null);
      const res = await middleware(makeRequest('/dashboard'));
      expect(res.status).toBe(307);
    });
  });
});
