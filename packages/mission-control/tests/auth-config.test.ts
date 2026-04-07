import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock @yclaw/core/auth's getAuthFacade
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
  default: vi.fn((config: { authorize: Function }) => ({
    ...config,
    type: 'credentials',
  })),
}));

const { authOptions } = await import('../src/lib/auth-config.js');

// Extract the authorize function from the Credentials Provider
const credentialsProvider = authOptions.providers[0] as unknown as {
  authorize: (credentials: { apiKey: string } | undefined) => Promise<unknown>;
};

describe('auth-config authorize()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns operator identity for a valid gzop_live_* key', async () => {
    const mockIdentity = {
      operatorId: 'op_test',
      displayName: 'Test Op',
      email: 'test@example.com',
      tier: 'contributor' as const,
      departments: ['marketing'],
      roleIds: ['role_contributor'],
      status: 'active' as const,
    };
    mockValidateOperatorKey.mockResolvedValue(mockIdentity);

    const result = await credentialsProvider.authorize({ apiKey: 'gzop_live_abc12345test' });

    expect(result).toEqual({
      id: 'op_test',
      name: 'Test Op',
      email: 'test@example.com',
      operatorId: 'op_test',
      displayName: 'Test Op',
      tier: 'contributor',
      departments: ['marketing'],
      roleIds: ['role_contributor'],
    });
    expect(mockValidateOperatorKey).toHaveBeenCalledWith('gzop_live_abc12345test');
    expect(mockRecordAudit).toHaveBeenCalledWith('op_test', expect.objectContaining({
      action: 'auth.login',
    }));
  });

  it('returns null for an invalid key', async () => {
    mockValidateOperatorKey.mockResolvedValue(null);
    const result = await credentialsProvider.authorize({ apiKey: 'wrong-key' });
    expect(result).toBeNull();
  });

  it('returns null for empty credentials', async () => {
    const result = await credentialsProvider.authorize(undefined);
    expect(result).toBeNull();
  });

  it('returns null for missing apiKey', async () => {
    const result = await credentialsProvider.authorize({ apiKey: '' });
    expect(result).toBeNull();
  });

  it('returns null for a revoked operator (validateOperatorKey returns null for non-active)', async () => {
    mockValidateOperatorKey.mockResolvedValue(null);
    const result = await credentialsProvider.authorize({ apiKey: 'gzop_live_revoked12345' });
    expect(result).toBeNull();
  });
});

describe('auth-config JWT callback', () => {
  const jwtCallback = authOptions.callbacks!.jwt!;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('embeds operator claims on initial sign-in', async () => {
    mockGetOperatorState.mockResolvedValue({
      status: 'active',
      tier: 'contributor',
      departments: ['marketing'],
      roleIds: ['role_contributor'],
    });

    const token = { sub: 'test' } as any;
    const user = {
      operatorId: 'op_test',
      displayName: 'Test',
      tier: 'contributor',
      departments: ['marketing'],
      roleIds: ['role_contributor'],
    } as any;

    const result = await (jwtCallback as Function)({ token, user });
    expect(result.operatorId).toBe('op_test');
    expect(result.tier).toBe('contributor');
    expect(result.departments).toEqual(['marketing']);
  });

  it('invalidates session when operator is revoked', async () => {
    mockGetOperatorState.mockResolvedValue({
      status: 'revoked',
      tier: 'contributor',
      departments: ['marketing'],
      roleIds: ['role_contributor'],
    });

    const token = {
      sub: 'test',
      operatorId: 'op_test',
      tier: 'contributor',
      departments: ['marketing'],
      roleIds: ['role_contributor'],
    } as any;

    const result = await (jwtCallback as Function)({ token });
    expect(result.operatorId).toBeUndefined();
  });

  it('invalidates session when DB is unreachable (fail-closed)', async () => {
    mockGetOperatorState.mockRejectedValue(new Error('Connection refused'));

    const token = {
      sub: 'test',
      operatorId: 'op_test',
      tier: 'contributor',
    } as any;

    const result = await (jwtCallback as Function)({ token });
    expect(result.operatorId).toBeUndefined();
  });

  it('picks up tier changes from live state', async () => {
    mockGetOperatorState.mockResolvedValue({
      status: 'active',
      tier: 'department_head',
      departments: ['marketing', 'support'],
      roleIds: ['role_department_head'],
    });

    const token = {
      sub: 'test',
      operatorId: 'op_test',
      tier: 'contributor',
      departments: ['marketing'],
      roleIds: ['role_contributor'],
    } as any;

    const result = await (jwtCallback as Function)({ token });
    expect(result.tier).toBe('department_head');
    expect(result.departments).toEqual(['marketing', 'support']);
  });
});
