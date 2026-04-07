import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OperatorRateLimiter } from '../src/operators/rate-limiter.js';

function createMockRedis() {
  const store = new Map<string, string>();
  const zsets = new Map<string, Map<string, number>>();

  return {
    eval: vi.fn().mockImplementation(async (_script: string, _numKeys: number, key: string, now: string, limit: string) => {
      // Simulate sliding window RPM check
      const nowMs = parseInt(now, 10);
      const limitNum = parseInt(limit, 10);
      const window = 60000;

      if (!zsets.has(key)) zsets.set(key, new Map());
      const zset = zsets.get(key)!;

      // Remove expired entries
      for (const [member, score] of zset) {
        if (score < nowMs - window) zset.delete(member);
      }

      if (zset.size >= limitNum) {
        return [0, 0, 1000]; // blocked, 0 remaining, retry in 1s
      }

      zset.set(`${nowMs}:${Math.random()}`, nowMs);
      return [1, limitNum - zset.size, 0]; // allowed
    }),
    incr: vi.fn().mockImplementation(async (key: string) => {
      const val = parseInt(store.get(key) || '0', 10) + 1;
      store.set(key, String(val));
      return val;
    }),
    decr: vi.fn().mockImplementation(async (key: string) => {
      const val = parseInt(store.get(key) || '0', 10) - 1;
      store.set(key, String(val));
      return val;
    }),
    get: vi.fn().mockImplementation(async (key: string) => store.get(key) || null),
    set: vi.fn().mockImplementation(async (key: string, val: string) => store.set(key, val)),
    expire: vi.fn().mockResolvedValue(1),
    _store: store,
  };
}

describe('OperatorRateLimiter', () => {
  let redis: ReturnType<typeof createMockRedis>;
  let limiter: OperatorRateLimiter;

  const defaultLimits = {
    requestsPerMinute: 60,
    maxConcurrentTasks: 5,
    dailyTaskQuota: 100,
  };

  beforeEach(() => {
    redis = createMockRedis();
    limiter = new OperatorRateLimiter(redis as any);
  });

  it('allows requests within RPM limit', async () => {
    const result = await limiter.checkLimit('op_test', defaultLimits);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBeGreaterThan(0);
  });

  it('blocks when RPM is exceeded', async () => {
    // Exhaust RPM limit
    for (let i = 0; i < 60; i++) {
      await limiter.checkLimit('op_test', defaultLimits);
    }

    const result = await limiter.checkLimit('op_test', defaultLimits);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('rpm_exceeded');
    expect(result.retryAfterMs).toBeGreaterThan(0);
  });

  it('blocks when concurrent tasks exceeded', async () => {
    // Max out concurrent tasks
    for (let i = 0; i < 5; i++) {
      await limiter.incrementConcurrent('op_test');
    }

    const result = await limiter.checkLimit('op_test', defaultLimits);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('concurrent_exceeded');
  });

  it('allows after decrementing concurrent', async () => {
    for (let i = 0; i < 5; i++) await limiter.incrementConcurrent('op_test');
    await limiter.decrementConcurrent('op_test');

    const result = await limiter.checkLimit('op_test', defaultLimits);
    expect(result.allowed).toBe(true);
  });

  it('blocks when daily quota exceeded', async () => {
    // Set daily count to max
    redis._store.set(`ratelimit:daily:op_test:${new Date().toISOString().slice(0, 10)}`, '100');

    const result = await limiter.checkLimit('op_test', defaultLimits);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('daily_quota_exceeded');
  });

  it('tracks concurrent tasks correctly', async () => {
    expect(await limiter.getConcurrent('op_test')).toBe(0);
    await limiter.incrementConcurrent('op_test');
    await limiter.incrementConcurrent('op_test');
    expect(await limiter.getConcurrent('op_test')).toBe(2);
    await limiter.decrementConcurrent('op_test');
    expect(await limiter.getConcurrent('op_test')).toBe(1);
  });

  it('decrement floors at 0', async () => {
    const val = await limiter.decrementConcurrent('op_test');
    expect(val).toBe(0);
  });

  it('tracks daily counts with date key', async () => {
    const count = await limiter.incrementDaily('op_test');
    expect(count).toBe(1);
    const count2 = await limiter.incrementDaily('op_test');
    expect(count2).toBe(2);
    const daily = await limiter.getDailyCount('op_test');
    expect(daily).toBe(2);
  });
});
