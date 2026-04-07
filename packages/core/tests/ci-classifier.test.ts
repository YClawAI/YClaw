import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/logging/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const {
  classifyCIFailure,
  hasNewerSuccessfulRun,
  getCiRepairAttempts,
  incrementCiRepairAttempts,
  MAX_CI_REPAIR_ATTEMPTS,
} = await import('../src/triggers/ci-classifier.js');

function okJson(body: unknown, status = 200) {
  return {
    ok: true,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

describe('ci-classifier', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GITHUB_TOKEN = 'test-token';
  });

  afterEach(() => {
    delete process.env.GITHUB_TOKEN;
  });

  it('does not treat a different successful workflow on the same SHA as resolved', async () => {
    mockFetch.mockResolvedValueOnce(okJson({
      workflow_runs: [
        { id: 23690112185, name: 'Agent Safety Guard', conclusion: 'success', status: 'completed' },
        { id: 23690112184, name: 'Build & Deploy YClaw Agents', conclusion: 'failure', status: 'completed' },
      ],
    }));

    await expect(
      hasNewerSuccessfulRun(
        'your-org',
        'yclaw',
        '4fc00b9b0e874d9cc4ff69bc5193527a1a042f82',
        23690112184,
        'Build & Deploy YClaw Agents',
      ),
    ).resolves.toBe(false);
  });

  it('treats a successful run from the same workflow as resolved', async () => {
    mockFetch.mockResolvedValueOnce(okJson({
      workflow_runs: [
        { id: 2002, name: 'Build & Deploy YClaw Agents', conclusion: 'success', status: 'completed' },
        { id: 2001, name: 'Build & Deploy YClaw Agents', conclusion: 'failure', status: 'completed' },
        { id: 1999, name: 'Agent Safety Guard', conclusion: 'success', status: 'completed' },
      ],
    }));

    await expect(
      hasNewerSuccessfulRun(
        'your-org',
        'yclaw',
        'deadbeef',
        2001,
        'Build & Deploy YClaw Agents',
      ),
    ).resolves.toBe(true);
  });

  it('caps the failure log excerpt size for downstream AO repair prompts', async () => {
    mockFetch
      .mockResolvedValueOnce(okJson({
        jobs: [
          { id: 777, name: 'Check', conclusion: 'failure' },
        ],
      }))
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => `prefix\n${'x'.repeat(3000)}`,
      });

    const result = await classifyCIFailure('your-org', 'yclaw', 777);

    expect(result.category).toBe('code_failure');
    expect(result.failedJobName).toBe('Check');
    expect(result.logExcerpt?.length).toBeLessThanOrEqual(1500);
    expect(result.logExcerpt).toBe('x'.repeat(1500));
  });
});

// ─── CI Repair Attempt Counter ──────────────────────────────────────────────

describe('getCiRepairAttempts', () => {
  it('returns 0 when redis is null', async () => {
    await expect(getCiRepairAttempts(null, 'org/repo', 42)).resolves.toBe(0);
  });

  it('returns 0 when redis is undefined', async () => {
    await expect(getCiRepairAttempts(undefined, 'org/repo', 42)).resolves.toBe(0);
  });

  it('returns 0 when key does not exist in redis', async () => {
    const redis = { incr: vi.fn(), expire: vi.fn(), get: vi.fn().mockResolvedValue(null) };
    await expect(getCiRepairAttempts(redis, 'org/repo', 42)).resolves.toBe(0);
  });

  it('returns the stored attempt count from redis', async () => {
    const redis = { incr: vi.fn(), expire: vi.fn(), get: vi.fn().mockResolvedValue('2') };
    await expect(getCiRepairAttempts(redis, 'org/repo', 42)).resolves.toBe(2);
  });

  it('returns 0 when redis.get throws', async () => {
    const redis = {
      incr: vi.fn(),
      expire: vi.fn(),
      get: vi.fn().mockRejectedValue(new Error('connection refused')),
    };
    await expect(getCiRepairAttempts(redis, 'org/repo', 42)).resolves.toBe(0);
  });
});

describe('incrementCiRepairAttempts', () => {
  it('returns 1 when redis is null', async () => {
    await expect(incrementCiRepairAttempts(null, 'org/repo', 42)).resolves.toBe(1);
  });

  it('returns 1 when redis is undefined', async () => {
    await expect(incrementCiRepairAttempts(undefined, 'org/repo', 42)).resolves.toBe(1);
  });

  it('increments the counter and sets TTL on first call', async () => {
    const redis = {
      incr: vi.fn().mockResolvedValue(1),
      expire: vi.fn().mockResolvedValue(1),
      get: vi.fn(),
    };
    const count = await incrementCiRepairAttempts(redis, 'org/repo', 42);
    expect(count).toBe(1);
    expect(redis.incr).toHaveBeenCalledOnce();
    expect(redis.expire).toHaveBeenCalledOnce();
  });

  it('increments without setting TTL on subsequent calls', async () => {
    const redis = {
      incr: vi.fn().mockResolvedValue(2),
      expire: vi.fn().mockResolvedValue(1),
      get: vi.fn(),
    };
    const count = await incrementCiRepairAttempts(redis, 'org/repo', 42);
    expect(count).toBe(2);
    expect(redis.incr).toHaveBeenCalledOnce();
    // TTL is only set on first increment (count === 1)
    expect(redis.expire).not.toHaveBeenCalled();
  });

  it('returns 1 when redis.incr throws', async () => {
    const redis = {
      incr: vi.fn().mockRejectedValue(new Error('connection refused')),
      expire: vi.fn(),
      get: vi.fn(),
    };
    await expect(incrementCiRepairAttempts(redis, 'org/repo', 42)).resolves.toBe(1);
  });
});

describe('MAX_CI_REPAIR_ATTEMPTS cap branching', () => {
  it('MAX_CI_REPAIR_ATTEMPTS constant is 2', () => {
    expect(MAX_CI_REPAIR_ATTEMPTS).toBe(2);
  });

  it('allows repair when attempt count is below the cap', async () => {
    const redis = { incr: vi.fn(), expire: vi.fn(), get: vi.fn().mockResolvedValue('1') };
    const count = await getCiRepairAttempts(redis, 'org/repo', 10);
    expect(count < MAX_CI_REPAIR_ATTEMPTS).toBe(true);
  });

  it('blocks repair when attempt count equals the cap', async () => {
    const redis = { incr: vi.fn(), expire: vi.fn(), get: vi.fn().mockResolvedValue('2') };
    const count = await getCiRepairAttempts(redis, 'org/repo', 10);
    expect(count >= MAX_CI_REPAIR_ATTEMPTS).toBe(true);
  });

  it('blocks repair when attempt count exceeds the cap', async () => {
    const redis = { incr: vi.fn(), expire: vi.fn(), get: vi.fn().mockResolvedValue('3') };
    const count = await getCiRepairAttempts(redis, 'org/repo', 10);
    expect(count >= MAX_CI_REPAIR_ATTEMPTS).toBe(true);
  });
});
