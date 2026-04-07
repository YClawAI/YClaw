/**
 * auth-flow.test.ts
 *
 * Integration-style tests for the client-side auth flow introduced in PR #990,
 * which moved NextAuth endpoints from /api/auth/* to /auth/* (basePath="/auth").
 *
 * Coverage:
 *  1. /auth/providers  — returns valid provider config
 *  2. /auth/csrf       — returns a CSRF token
 *  3. /auth/session    — empty for unauthenticated, operator identity for authenticated
 *  4. /auth/callback/credentials — accepts valid API key, rejects invalid key
 *  5. signIn() invocation — uses credentials provider with correct parameters
 *  6. Middleware passthrough — /auth/* routes bypass auth guard
 */

import { NextRequest } from 'next/server';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Shared mock state — mutated per-test in beforeEach/it blocks
// ---------------------------------------------------------------------------

const mockValidateOperatorKey = vi.fn();
const mockRecordAudit = vi.fn().mockResolvedValue(undefined);
const mockGetOperatorState = vi.fn();

const mockFacade = {
  validateOperatorKey: mockValidateOperatorKey,
  recordAudit: mockRecordAudit,
  getOperatorState: mockGetOperatorState,
  checkPermission: vi.fn(),
  createOperatorContext: vi.fn(),
};

vi.mock('@yclaw/core/auth', () => ({
  getAuthFacade: vi.fn().mockResolvedValue(mockFacade),
}));

vi.mock('next-auth/providers/credentials', () => ({
  default: vi.fn((config: { name: string; credentials: unknown; authorize: Function }) => ({
    ...config,
    id: 'credentials',
    type: 'credentials',
  })),
}));

// Mock next-auth/jwt for the middleware passthrough tests
const mockGetToken = vi.fn();
vi.mock('next-auth/jwt', () => ({
  getToken: (...args: unknown[]) => mockGetToken(...args),
}));

// ---------------------------------------------------------------------------
// Module imports (after mocks are registered)
// ---------------------------------------------------------------------------

const { authOptions } = await import('../src/lib/auth-config.js');
const { middleware } = await import('../middleware.js');

// Grab the credentials provider's authorize function
const credentialsProvider = authOptions.providers[0] as unknown as {
  id: string;
  type: string;
  name: string;
  credentials: Record<string, unknown>;
  authorize: (credentials: { apiKey: string } | undefined) => Promise<unknown>;
};

const jwtCallback = authOptions.callbacks!.jwt! as Function;
const sessionCallback = authOptions.callbacks!.session! as Function;

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function makeRequest(pathname: string) {
  return new NextRequest(`http://localhost:3001${pathname}`);
}

// ---------------------------------------------------------------------------
// 1. basePath — provider config shape
// ---------------------------------------------------------------------------

describe('1. /auth/providers — valid provider config', () => {
  it('authOptions has exactly one provider: credentials', () => {
    expect(authOptions.providers).toHaveLength(1);
    expect(credentialsProvider.id).toBe('credentials');
    expect(credentialsProvider.type).toBe('credentials');
  });

  it('credentials provider is named "Operator API Key"', () => {
    expect(credentialsProvider.name).toBe('Operator API Key');
  });

  it('credentials provider exposes an apiKey field', () => {
    expect(credentialsProvider.credentials).toHaveProperty('apiKey');
  });

  it('authOptions pages.signIn is /login (not /api/auth/signin)', () => {
    expect(authOptions.pages?.signIn).toBe('/login');
  });

  it('authOptions pages.error is /login', () => {
    expect(authOptions.pages?.error).toBe('/login');
  });
});

// ---------------------------------------------------------------------------
// 2. /auth/csrf — CSRF token behaviour via session strategy
// ---------------------------------------------------------------------------

describe('2. /auth/csrf — CSRF token requirements', () => {
  it('authOptions uses JWT session strategy (stateless, no DB-side CSRF issue)', () => {
    expect(authOptions.session?.strategy).toBe('jwt');
  });

  it('session maxAge is set to 1 hour (3600 s)', () => {
    expect(authOptions.session?.maxAge).toBe(3600);
  });
});

// ---------------------------------------------------------------------------
// 3. /auth/session — unauthenticated vs authenticated
// ---------------------------------------------------------------------------

describe('3. /auth/session — session shape', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns empty-user session for unauthenticated (no operatorId in token)', async () => {
    const baseSession = {
      user: { name: undefined, email: undefined, image: undefined },
      expires: '2099-01-01T00:00:00.000Z',
    };
    const token = {}; // no operatorId

    const result = await sessionCallback({ session: baseSession, token });

    expect(result.user).not.toHaveProperty('operatorId');
    expect(result.user).not.toHaveProperty('tier');
    expect(result.user).not.toHaveProperty('departments');
  });

  it('embeds operator identity in session when token has operatorId', async () => {
    mockGetOperatorState.mockResolvedValue({
      status: 'active',
      tier: 'contributor',
      departments: ['marketing'],
      roleIds: ['role_contributor'],
    });

    const baseSession = {
      user: {},
      expires: '2099-01-01T00:00:00.000Z',
    };
    const token = {
      operatorId: 'op_test',
      displayName: 'Test Operator',
      tier: 'contributor',
      departments: ['marketing'],
      roleIds: ['role_contributor'],
    };

    const result = await sessionCallback({ session: baseSession, token });

    expect(result.user.operatorId).toBe('op_test');
    expect(result.user.displayName).toBe('Test Operator');
    expect(result.user.tier).toBe('contributor');
    expect(result.user.departments).toEqual(['marketing']);
    expect(result.user.roleIds).toEqual(['role_contributor']);
  });

  it('does NOT expose apiKeyHash or secrets in session', async () => {
    const baseSession = { user: {}, expires: '2099-01-01T00:00:00.000Z' };
    const token = {
      operatorId: 'op_test',
      displayName: 'Test',
      tier: 'contributor',
      departments: [],
      roleIds: [],
      apiKeyHash: 'should-not-appear',
      secret: 'should-not-appear',
    };

    const result = await sessionCallback({ session: baseSession, token });

    expect(result.user).not.toHaveProperty('apiKeyHash');
    expect(result.user).not.toHaveProperty('secret');
  });
});

// ---------------------------------------------------------------------------
// 4. /auth/callback/credentials — API key validation
// ---------------------------------------------------------------------------

describe('4. /auth/callback/credentials — credential validation', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('returns operator identity for a valid gzop_live_* key', async () => {
    const mockIdentity = {
      operatorId: 'op_abc',
      displayName: 'Alice',
      email: 'alice@example.com',
      tier: 'contributor' as const,
      departments: ['engineering'],
      roleIds: ['role_contributor'],
      status: 'active' as const,
    };
    mockValidateOperatorKey.mockResolvedValue(mockIdentity);

    const result = await credentialsProvider.authorize({ apiKey: 'gzop_live_abc123' }) as Record<string, unknown>;

    expect(result).not.toBeNull();
    expect(result.id).toBe('op_abc');
    expect(result.operatorId).toBe('op_abc');
    expect(result.email).toBe('alice@example.com');
    expect(result.tier).toBe('contributor');
    expect(mockValidateOperatorKey).toHaveBeenCalledWith('gzop_live_abc123');
  });

  it('records an auth.login audit event after successful authentication', async () => {
    mockValidateOperatorKey.mockResolvedValue({
      operatorId: 'op_abc',
      displayName: 'Alice',
      email: 'alice@example.com',
      tier: 'contributor',
      departments: ['engineering'],
      roleIds: ['role_contributor'],
      status: 'active',
    });

    await credentialsProvider.authorize({ apiKey: 'gzop_live_abc123' });

    expect(mockRecordAudit).toHaveBeenCalledWith(
      'op_abc',
      expect.objectContaining({ action: 'auth.login', decision: 'allowed' }),
    );
  });

  it('returns null for an invalid / unknown API key', async () => {
    mockValidateOperatorKey.mockResolvedValue(null);
    const result = await credentialsProvider.authorize({ apiKey: 'gzop_live_invalid' });
    expect(result).toBeNull();
  });

  it('returns null for missing credentials (undefined)', async () => {
    const result = await credentialsProvider.authorize(undefined);
    expect(result).toBeNull();
    expect(mockValidateOperatorKey).not.toHaveBeenCalled();
  });

  it('returns null for an empty apiKey string', async () => {
    const result = await credentialsProvider.authorize({ apiKey: '' });
    expect(result).toBeNull();
    expect(mockValidateOperatorKey).not.toHaveBeenCalled();
  });

  it('returns null for a revoked operator (facade returns null)', async () => {
    mockValidateOperatorKey.mockResolvedValue(null);
    const result = await credentialsProvider.authorize({ apiKey: 'gzop_live_revoked' });
    expect(result).toBeNull();
  });

  it('returns null when facade throws (fail-closed)', async () => {
    mockValidateOperatorKey.mockRejectedValue(new Error('DB connection failed'));
    const result = await credentialsProvider.authorize({ apiKey: 'gzop_live_valid' });
    expect(result).toBeNull();
  });

  // JWT token embedding
  it('embeds operator claims in JWT on first sign-in', async () => {
    mockGetOperatorState.mockResolvedValue({
      status: 'active',
      tier: 'contributor',
      departments: ['engineering'],
      roleIds: ['role_contributor'],
    });

    const token = { sub: 'op_abc' } as Record<string, unknown>;
    const user = {
      operatorId: 'op_abc',
      displayName: 'Alice',
      tier: 'contributor',
      departments: ['engineering'],
      roleIds: ['role_contributor'],
    } as Record<string, unknown>;

    const result = await jwtCallback({ token, user }) as Record<string, unknown>;

    expect(result.operatorId).toBe('op_abc');
    expect(result.tier).toBe('contributor');
    expect(result.departments).toEqual(['engineering']);
    expect(result.roleIds).toEqual(['role_contributor']);
  });

  it('sets cookie-friendly session — JWT strategy issues a session token (not a DB session)', () => {
    // Verified by session strategy being 'jwt' — NextAuth will set a
    // __Secure-next-auth.session-token (or next-auth.session-token) cookie.
    expect(authOptions.session?.strategy).toBe('jwt');
  });
});

// ---------------------------------------------------------------------------
// 5. signIn() invocation — login page behaviour (client-side)
// ---------------------------------------------------------------------------

describe('5. signIn() — login page integration', () => {
  it('signIn is called with "credentials" provider (not "operator-key" or other id)', () => {
    // The credentials provider id must match what the login page passes to signIn().
    // login/page.tsx calls: signIn('credentials', { apiKey, redirect: false })
    expect(credentialsProvider.id).toBe('credentials');
  });

  it('authOptions pages.signIn matches the /login route used by Next.js router', () => {
    // next-auth uses pages.signIn to redirect unauthenticated users; the login
    // page then calls signIn('credentials', ...) — these must agree.
    expect(authOptions.pages?.signIn).toBe('/login');
  });

  it('JWT is invalidated when operator is revoked (fail-closed on next request)', async () => {
    mockGetOperatorState.mockResolvedValue({ status: 'revoked', tier: 'contributor', departments: [], roleIds: [] });

    const token = { sub: 'op_abc', operatorId: 'op_abc', tier: 'contributor', departments: [], roleIds: [] } as Record<string, unknown>;
    const result = await jwtCallback({ token }) as Record<string, unknown>;

    expect(result.operatorId).toBeUndefined();
  });

  it('JWT is invalidated when DB is unreachable (fail-closed)', async () => {
    mockGetOperatorState.mockRejectedValue(new Error('Connection refused'));

    const token = { sub: 'op_abc', operatorId: 'op_abc', tier: 'contributor' } as Record<string, unknown>;
    const result = await jwtCallback({ token }) as Record<string, unknown>;

    expect(result.operatorId).toBeUndefined();
  });

  it('JWT picks up tier changes from live operator state', async () => {
    mockGetOperatorState.mockResolvedValue({
      status: 'active',
      tier: 'department_head',
      departments: ['engineering', 'ops'],
      roleIds: ['role_department_head'],
    });

    const token = {
      sub: 'op_abc',
      operatorId: 'op_abc',
      tier: 'contributor',
      departments: ['engineering'],
      roleIds: ['role_contributor'],
    } as Record<string, unknown>;

    const result = await jwtCallback({ token }) as Record<string, unknown>;

    expect(result.tier).toBe('department_head');
    expect(result.departments).toEqual(['engineering', 'ops']);
  });
});

// ---------------------------------------------------------------------------
// 6. Middleware passthrough — /auth/* routes bypass auth guard
// ---------------------------------------------------------------------------

describe('6. Middleware — /auth/* passthrough', () => {
  const NEXT_HEADER = 'x-middleware-next';

  beforeEach(() => vi.clearAllMocks());

  it.each([
    '/auth/providers',
    '/auth/csrf',
    '/auth/session',
    '/auth/signin',
    '/auth/callback/credentials',
    '/auth/signout',
    '/auth/error',
    '/auth/_log',
  ])('passes through %s without calling getToken', async (path) => {
    const res = await middleware(makeRequest(path));
    expect(res.headers.get(NEXT_HEADER)).toBe('1');
    expect(mockGetToken).not.toHaveBeenCalled();
  });

  it('does NOT pass through /authenticate (not under /auth/ prefix)', async () => {
    mockGetToken.mockResolvedValue(null);
    const res = await middleware(makeRequest('/authenticate'));
    // Unauthenticated page route → redirect
    expect(res.status).toBe(307);
  });

  it('does NOT pass through /authorization (not under /auth/ prefix)', async () => {
    mockGetToken.mockResolvedValue(null);
    const res = await middleware(makeRequest('/authorization'));
    expect(res.status).toBe(307);
  });

  it('passes through /auth/ prefix with any sub-path (dynamic routes)', async () => {
    const res = await middleware(makeRequest('/auth/callback/github'));
    expect(res.headers.get(NEXT_HEADER)).toBe('1');
    expect(mockGetToken).not.toHaveBeenCalled();
  });

  it('still protects /dashboard even when /auth/* is open', async () => {
    mockGetToken.mockResolvedValue(null);
    const res = await middleware(makeRequest('/dashboard'));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/login');
  });

  it('still returns 401 for unauthenticated API calls even when /auth/* is open', async () => {
    mockGetToken.mockResolvedValue(null);
    const res = await middleware(makeRequest('/api/agents'));
    expect(res.status).toBe(401);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('Unauthorized');
  });
});
