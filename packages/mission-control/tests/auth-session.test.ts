import { describe, expect, it, vi, beforeEach } from 'vitest';

// Mock next-auth's getServerSession
const mockNextAuthGetServerSession = vi.fn();
vi.mock('next-auth', () => ({
  getServerSession: mockNextAuthGetServerSession,
}));

// Mock auth-config (needed by auth-session)
vi.mock('../src/lib/auth-config.js', () => ({
  authOptions: { providers: [] },
}));

const { getServerSession } = await import('../src/lib/auth-session.js');

describe('getServerSession()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns session with operator identity when authenticated', async () => {
    const mockSession = {
      user: {
        operatorId: 'op_test',
        displayName: 'Test',
        tier: 'contributor',
        departments: ['marketing'],
        roleIds: ['role_contributor'],
      },
      expires: new Date(Date.now() + 3600000).toISOString(),
    };
    mockNextAuthGetServerSession.mockResolvedValue(mockSession);

    const session = await getServerSession();
    expect(session).toEqual(mockSession);
    expect(session?.user.operatorId).toBe('op_test');
    expect(session?.user.tier).toBe('contributor');
  });

  it('returns null when no session exists', async () => {
    mockNextAuthGetServerSession.mockResolvedValue(null);

    const session = await getServerSession();
    expect(session).toBeNull();
  });

  it('passes authOptions to next-auth getServerSession', async () => {
    mockNextAuthGetServerSession.mockResolvedValue(null);
    await getServerSession();

    expect(mockNextAuthGetServerSession).toHaveBeenCalledWith(
      expect.objectContaining({ providers: [] }),
    );
  });
});
