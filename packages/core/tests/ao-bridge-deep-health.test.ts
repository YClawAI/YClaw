import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/logging/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

function makeAuditLog() {
  const insertOne = vi.fn().mockResolvedValue({});
  return {
    getDb: vi.fn().mockReturnValue({
      collection: () => ({ insertOne }),
    }),
    _insertOne: insertOne,
  };
}

const HEALTHY_RESPONSE = {
  status: 'healthy' as const,
  components: {
    ec2: { status: 'ok' as const, uptime_seconds: 12345 },
    docker: { status: 'ok' as const, running_containers: 2 },
    disk: { status: 'ok' as const, free_pct: 45 },
    last_session: { status: 'ok' as const, completed_at: '2026-04-13T12:00:00Z' },
  },
  queue_depth: 3,
  circuit_breakers: { 'YClawAI/YClaw': { open: false, failures: 0 } },
};

describe('AoBridge.deepHealth()', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let AoBridge: (typeof import('../src/ao/bridge.js'))['AoBridge'];

  beforeEach(async () => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    process.env.AO_SERVICE_URL = 'http://ao.test:8420';
    process.env.AO_AUTH_TOKEN = 'test-token';
    ({ AoBridge } = await import('../src/ao/bridge.js'));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
    delete process.env.AO_SERVICE_URL;
    delete process.env.AO_AUTH_TOKEN;
  });

  it('returns structured health data on success', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => HEALTHY_RESPONSE,
    });

    const bridge = new AoBridge(makeAuditLog() as any);
    const result = await bridge.deepHealth();

    expect(result).not.toBeNull();
    expect(result!.status).toBe('healthy');
    expect(result!.queue_depth).toBe(3);
    expect(result!.components.ec2?.status).toBe('ok');
    expect(result!.components.ec2?.uptime_seconds).toBe(12345);
    expect(result!.components.docker?.running_containers).toBe(2);
    expect(result!.components.disk?.free_pct).toBe(45);
    expect(result!.components.last_session?.completed_at).toBe('2026-04-13T12:00:00Z');
    expect(result!.circuit_breakers['YClawAI/YClaw']).toEqual({ open: false, failures: 0 });
  });

  it('calls /health/deep endpoint with auth header', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => HEALTHY_RESPONSE,
    });

    const bridge = new AoBridge(makeAuditLog() as any);
    await bridge.deepHealth();

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, opts] = fetchMock.mock.calls[0]!;
    expect(url).toBe('http://ao.test:8420/health/deep');
    expect(opts.headers['X-AO-TOKEN']).toBe('test-token');
  });

  it('returns null when the HTTP response is not ok (5xx)', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 503 });

    const bridge = new AoBridge(makeAuditLog() as any);
    const result = await bridge.deepHealth();

    expect(result).toBeNull();
  });

  it('returns null on network error (AO unreachable)', async () => {
    fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const bridge = new AoBridge(makeAuditLog() as any);
    const result = await bridge.deepHealth();

    expect(result).toBeNull();
  });

  it('returns null on timeout', async () => {
    fetchMock.mockRejectedValueOnce(new DOMException('The operation was aborted', 'AbortError'));

    const bridge = new AoBridge(makeAuditLog() as any);
    const result = await bridge.deepHealth();

    expect(result).toBeNull();
  });

  it('does NOT trip the circuit breaker on failure', async () => {
    fetchMock.mockRejectedValue(new Error('connection refused'));

    const bridge = new AoBridge(makeAuditLog() as any);
    const repo = 'YClawAI/YClaw';

    // Call deepHealth 5 times — more than CIRCUIT_THRESHOLD (3)
    for (let i = 0; i < 5; i++) {
      await bridge.deepHealth();
    }

    // Circuit must NOT be open — deepHealth failures must not trip it
    expect(bridge.isCircuitOpen(repo)).toBe(false);
  });

  it('returns degraded status when AO is degraded', async () => {
    const degradedResponse = {
      ...HEALTHY_RESPONSE,
      status: 'degraded' as const,
      components: {
        ...HEALTHY_RESPONSE.components,
        docker: { status: 'degraded' as const, running_containers: 1 },
      },
    };

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => degradedResponse,
    });

    const bridge = new AoBridge(makeAuditLog() as any);
    const result = await bridge.deepHealth();

    expect(result).not.toBeNull();
    expect(result!.status).toBe('degraded');
    expect(result!.components.docker?.status).toBe('degraded');
  });

  it('returns unhealthy status when AO is down', async () => {
    const unhealthyResponse = {
      status: 'unhealthy' as const,
      components: {
        ec2: { status: 'error' as const },
      },
      queue_depth: 0,
      circuit_breakers: {},
    };

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => unhealthyResponse,
    });

    const bridge = new AoBridge(makeAuditLog() as any);
    const result = await bridge.deepHealth();

    expect(result).not.toBeNull();
    expect(result!.status).toBe('unhealthy');
  });

  it('exposes queue_depth from health response', async () => {
    const queuedResponse = { ...HEALTHY_RESPONSE, queue_depth: 7 };

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => queuedResponse,
    });

    const bridge = new AoBridge(makeAuditLog() as any);
    const result = await bridge.deepHealth();

    expect(result!.queue_depth).toBe(7);
  });
});
