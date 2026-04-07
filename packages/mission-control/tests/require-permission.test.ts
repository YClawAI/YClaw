import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Session } from 'next-auth';

// Mock auth-session
vi.mock('../src/lib/auth-session.js', () => ({
  getServerSession: vi.fn(),
}));

// Mock @yclaw/core/auth
vi.mock('@yclaw/core/auth', () => ({
  getAuthFacade: vi.fn().mockResolvedValue({
    checkPermission: vi.fn(),
  }),
}));

const { getServerSession } = await import('../src/lib/auth-session.js');
const { requireSession, checkTier, checkDepartment, checkSelfOrRoot } = await import(
  '../src/lib/require-permission.js'
);

function makeSession(overrides: Partial<Session['user']> = {}): Session {
  return {
    expires: new Date(Date.now() + 3600000).toISOString(),
    user: {
      operatorId: 'op_test',
      displayName: 'Test',
      tier: 'contributor',
      departments: ['marketing'],
      roleIds: ['role_contributor'],
      ...overrides,
    },
  } as Session;
}

describe('requireSession()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns session when authenticated', async () => {
    const session = makeSession();
    vi.mocked(getServerSession).mockResolvedValue(session);

    const result = await requireSession();
    expect(result.session).toBe(session);
    expect(result.error).toBeUndefined();
  });

  it('returns 401 error when unauthenticated', async () => {
    vi.mocked(getServerSession).mockResolvedValue(null);

    const result = await requireSession();
    expect(result.session).toBeUndefined();
    expect(result.error).toBeDefined();
    expect(result.error!.status).toBe(401);
  });
});

describe('checkTier()', () => {
  it('allows root for root-required route', () => {
    const session = makeSession({ tier: 'root' });
    expect(checkTier(session, 'root')).toBeNull();
  });

  it('allows root for contributor-required route', () => {
    const session = makeSession({ tier: 'root' });
    expect(checkTier(session, 'contributor')).toBeNull();
  });

  it('allows department_head for department_head-required route', () => {
    const session = makeSession({ tier: 'department_head' });
    expect(checkTier(session, 'department_head')).toBeNull();
  });

  it('denies contributor for root-required route', () => {
    const session = makeSession({ tier: 'contributor' });
    const denied = checkTier(session, 'root');
    expect(denied).not.toBeNull();
    expect(denied!.status).toBe(403);
  });

  it('denies observer for contributor-required route', () => {
    const session = makeSession({ tier: 'observer' });
    const denied = checkTier(session, 'contributor');
    expect(denied).not.toBeNull();
    expect(denied!.status).toBe(403);
  });

  it('allows observer for observer-required route', () => {
    const session = makeSession({ tier: 'observer' });
    expect(checkTier(session, 'observer')).toBeNull();
  });
});

describe('checkDepartment()', () => {
  it('root bypasses all department checks', () => {
    const session = makeSession({ tier: 'root', departments: [] });
    expect(checkDepartment(session, 'marketing')).toBeNull();
    expect(checkDepartment(session, 'finance')).toBeNull();
  });

  it('allows operator in the requested department', () => {
    const session = makeSession({ departments: ['marketing', 'support'] });
    expect(checkDepartment(session, 'marketing')).toBeNull();
    expect(checkDepartment(session, 'support')).toBeNull();
  });

  it('denies operator not in the requested department', () => {
    const session = makeSession({ departments: ['marketing'] });
    const denied = checkDepartment(session, 'finance');
    expect(denied).not.toBeNull();
    expect(denied!.status).toBe(403);
  });
});

describe('checkSelfOrRoot()', () => {
  it('allows root for any target', () => {
    const session = makeSession({ tier: 'root', operatorId: 'op_root' });
    expect(checkSelfOrRoot(session, 'op_other')).toBeNull();
  });

  it('allows self-action', () => {
    const session = makeSession({ operatorId: 'op_test' });
    expect(checkSelfOrRoot(session, 'op_test')).toBeNull();
  });

  it('denies non-root acting on another operator', () => {
    const session = makeSession({ tier: 'contributor', operatorId: 'op_test' });
    const denied = checkSelfOrRoot(session, 'op_other');
    expect(denied).not.toBeNull();
    expect(denied!.status).toBe(403);
  });
});
