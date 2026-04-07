import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createAuthMiddleware, createAuditMiddleware, requireTier, requireDepartment } from '../src/operators/middleware.js';
import type { Operator } from '../src/operators/types.js';

// Mock request/response/next
function mockReq(overrides: Record<string, unknown> = {}): any {
  return {
    path: '/v1/operators/me',
    method: 'GET',
    headers: {},
    params: {},
    query: {},
    body: {},
    ip: '127.0.0.1',
    ...overrides,
  };
}

function mockRes(): any {
  const res: any = { statusCode: 200 };
  res.status = vi.fn().mockImplementation((code: number) => { res.statusCode = code; return res; });
  res.json = vi.fn().mockReturnValue(res);
  res.on = vi.fn();
  return res;
}

const mockNext = vi.fn();

const mockOperator: Operator = {
  operatorId: 'op_test',
  displayName: 'Test',
  role: 'Tester',
  email: 'test@example.com',
  apiKeyHash: '', // Will be set in tests
  apiKeyPrefix: 'testpfx1',
  tier: 'contributor',
  departments: ['marketing', 'support'],
  priorityClass: 50,
  limits: { requestsPerMinute: 60, maxConcurrentTasks: 5, dailyTaskQuota: 100 },
  status: 'active',
  tailscaleIPs: [],
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockRootOperator: Operator = {
  ...mockOperator,
  operatorId: 'op_root',
  tier: 'root',
  departments: ['*'],
  priorityClass: 100,
};

describe('requireTier', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('allows a root operator for any tier requirement', () => {
    const middleware = requireTier('department_head');
    const req = mockReq({ operator: mockRootOperator });
    const res = mockRes();

    middleware(req, res, mockNext);
    expect(mockNext).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('blocks a contributor when department_head is required', () => {
    const middleware = requireTier('department_head');
    const req = mockReq({ operator: mockOperator });
    const res = mockRes();

    middleware(req, res, mockNext);
    expect(mockNext).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('allows a contributor when contributor tier is required', () => {
    const middleware = requireTier('contributor');
    const req = mockReq({ operator: mockOperator });
    const res = mockRes();

    middleware(req, res, mockNext);
    expect(mockNext).toHaveBeenCalled();
  });

  it('returns 401 when no operator is attached', () => {
    const middleware = requireTier('contributor');
    const req = mockReq();
    const res = mockRes();

    middleware(req, res, mockNext);
    expect(mockNext).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });
});

describe('requireDepartment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('allows root operator access to any department', () => {
    const middleware = requireDepartment();
    const req = mockReq({ operator: mockRootOperator, params: { department: 'finance' } });
    const res = mockRes();

    middleware(req, res, mockNext);
    expect(mockNext).toHaveBeenCalled();
  });

  it('allows access to an authorized department', () => {
    const middleware = requireDepartment();
    const req = mockReq({ operator: mockOperator, params: { department: 'marketing' } });
    const res = mockRes();

    middleware(req, res, mockNext);
    expect(mockNext).toHaveBeenCalled();
  });

  it('blocks access to an unauthorized department', () => {
    const middleware = requireDepartment();
    const req = mockReq({ operator: mockOperator, params: { department: 'finance' } });
    const res = mockRes();

    middleware(req, res, mockNext);
    expect(mockNext).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('passes through when no department is specified', () => {
    const middleware = requireDepartment();
    const req = mockReq({ operator: mockOperator, params: {} });
    const res = mockRes();

    middleware(req, res, mockNext);
    expect(mockNext).toHaveBeenCalled();
  });

  it('returns 401 when no operator is attached', () => {
    const middleware = requireDepartment();
    const req = mockReq({ params: { department: 'marketing' } });
    const res = mockRes();

    middleware(req, res, mockNext);
    expect(res.status).toHaveBeenCalledWith(401);
  });
});

describe('createAuthMiddleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('skips auth for accept-invite endpoint', async () => {
    const mockStore = { getByApiKeyPrefix: vi.fn(), updateLastActive: vi.fn(), getByOperatorId: vi.fn() } as any;
    const mockAudit = { log: vi.fn() } as any;
    const middleware = createAuthMiddleware(mockStore, mockAudit, null, 'op_root');

    const req = mockReq({ path: '/v1/operators/accept-invite', method: 'POST' });
    const res = mockRes();

    await middleware(req, res, mockNext);
    expect(mockNext).toHaveBeenCalled();
    expect(mockStore.getByApiKeyPrefix).not.toHaveBeenCalled();
  });

  it('skips auth for exempt paths (health, github, slack)', async () => {
    const mockStore = { getByApiKeyPrefix: vi.fn(), updateLastActive: vi.fn(), getByOperatorId: vi.fn() } as any;
    const mockAudit = { log: vi.fn() } as any;
    const middleware = createAuthMiddleware(mockStore, mockAudit, null, 'op_root');

    for (const path of ['/health', '/github/webhook', '/slack/events', '/telegram/webhook']) {
      vi.clearAllMocks();
      const req = mockReq({ path });
      const res = mockRes();
      await middleware(req, res, mockNext);
      expect(mockNext).toHaveBeenCalled();
    }
  });

  it('returns 401 on /v1/* with no auth header', async () => {
    const mockStore = { getByApiKeyPrefix: vi.fn(), updateLastActive: vi.fn(), getByOperatorId: vi.fn() } as any;
    const mockAudit = { log: vi.fn() } as any;
    const middleware = createAuthMiddleware(mockStore, mockAudit, null, 'op_root');

    const req = mockReq({ path: '/v1/operators/me', headers: {} });
    const res = mockRes();

    await middleware(req, res, mockNext);
    expect(mockNext).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('injects root operator on /api/* with no auth header (backward compat)', async () => {
    const mockStore = {
      getByApiKeyPrefix: vi.fn(),
      updateLastActive: vi.fn(),
      getByOperatorId: vi.fn().mockResolvedValue(mockRootOperator),
    } as any;
    const mockAudit = { log: vi.fn() } as any;
    const middleware = createAuthMiddleware(mockStore, mockAudit, null, 'op_root');

    const req = mockReq({ path: '/api/trigger', headers: {} });
    const res = mockRes();

    await middleware(req, res, mockNext);
    expect(mockNext).toHaveBeenCalled();
    expect(req.operator).toEqual(mockRootOperator);
    expect(mockStore.getByOperatorId).toHaveBeenCalledWith('op_root');
  });

  it('returns 401 for invalid key format', async () => {
    const mockStore = { getByApiKeyPrefix: vi.fn(), updateLastActive: vi.fn(), getByOperatorId: vi.fn() } as any;
    const mockAudit = { log: vi.fn() } as any;
    const middleware = createAuthMiddleware(mockStore, mockAudit, null, 'op_root');

    const req = mockReq({
      path: '/v1/operators/me',
      headers: { authorization: 'Bearer invalid_key' },
    });
    const res = mockRes();

    await middleware(req, res, mockNext);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('returns 403 for revoked operator', async () => {
    const revokedOp = { ...mockOperator, status: 'revoked' as const };
    const { generateApiKey } = await import('../src/operators/api-keys.js');
    const { key, prefix, hash } = await generateApiKey();
    revokedOp.apiKeyHash = hash;
    revokedOp.apiKeyPrefix = prefix;

    const mockStore = {
      getByApiKeyPrefix: vi.fn().mockResolvedValue(revokedOp),
      updateLastActive: vi.fn(),
      getByOperatorId: vi.fn(),
    } as any;
    const mockAudit = { log: vi.fn() } as any;
    const middleware = createAuthMiddleware(mockStore, mockAudit, null, 'op_root');

    const req = mockReq({
      path: '/v1/operators/me',
      headers: { authorization: `Bearer ${key}` },
    });
    const res = mockRes();

    await middleware(req, res, mockNext);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('attaches operator to request on successful auth', async () => {
    const { generateApiKey } = await import('../src/operators/api-keys.js');
    const { key, prefix, hash } = await generateApiKey();
    const activeOp = { ...mockOperator, apiKeyHash: hash, apiKeyPrefix: prefix };

    const mockStore = {
      getByApiKeyPrefix: vi.fn().mockResolvedValue(activeOp),
      updateLastActive: vi.fn(),
      getByOperatorId: vi.fn(),
    } as any;
    const mockAudit = { log: vi.fn() } as any;
    const middleware = createAuthMiddleware(mockStore, mockAudit, null, 'op_root');

    const req = mockReq({
      path: '/v1/operators/me',
      headers: { authorization: `Bearer ${key}` },
    });
    const res = mockRes();

    await middleware(req, res, mockNext);
    expect(mockNext).toHaveBeenCalled();
    expect(req.operator).toEqual(activeOp);
    expect(mockStore.updateLastActive).toHaveBeenCalledWith(activeOp.operatorId);
  });
});

describe('createAuditMiddleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('registers a finish listener and logs on response', () => {
    const mockAudit = { log: vi.fn() } as any;
    const middleware = createAuditMiddleware(mockAudit);

    const req = mockReq({ path: '/v1/operators/me', method: 'GET', operator: mockRootOperator });
    const res = mockRes();

    middleware(req, res, mockNext);
    expect(mockNext).toHaveBeenCalled();
    expect(res.on).toHaveBeenCalledWith('finish', expect.any(Function));

    // Simulate response finish
    const finishCallback = res.on.mock.calls[0][1];
    finishCallback();
    expect(mockAudit.log).toHaveBeenCalledWith(expect.objectContaining({
      operatorId: 'op_root',
      decision: 'allowed',
    }));
  });

  it('skips exempt paths', () => {
    const mockAudit = { log: vi.fn() } as any;
    const middleware = createAuditMiddleware(mockAudit);

    const req = mockReq({ path: '/health' });
    const res = mockRes();

    middleware(req, res, mockNext);
    expect(mockNext).toHaveBeenCalled();
    expect(res.on).not.toHaveBeenCalled();
  });

  it('does not log when no operator is attached', () => {
    const mockAudit = { log: vi.fn() } as any;
    const middleware = createAuditMiddleware(mockAudit);

    const req = mockReq({ path: '/v1/something' });
    const res = mockRes();

    middleware(req, res, mockNext);

    // Simulate response finish — no operator so should not log
    const finishCallback = res.on.mock.calls[0][1];
    finishCallback();
    expect(mockAudit.log).not.toHaveBeenCalled();
  });
});
