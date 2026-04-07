/**
 * Tests for the heartbeat Elvis pattern — lightweight pre-flight check
 * that skips the Strategist LLM when there's no pending work.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/logging/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

const { shouldTriggerHeartbeat, recordFullHeartbeat } = await import(
  '../src/services/heartbeat-checker.js'
);

// ─── In-Memory Redis Mock ───────────────────────────────────────────────────

class MockRedis {
  private store = new Map<string, string>();
  private hashes = new Map<string, Record<string, string>>();
  private scanKeys: string[] = [];

  // Pre-populate task hashes for SCAN to find
  addTaskHash(key: string, fields: Record<string, string>) {
    this.hashes.set(key, fields);
    this.scanKeys.push(key);
  }

  async scan(
    cursor: string,
    _match: string,
    _pattern: string,
    _count: string,
    _batchSize: string,
  ): Promise<[string, string[]]> {
    // Return all keys on first call, '0' cursor to signal done
    if (cursor === '0' && this.scanKeys.length > 0) {
      const keys = [...this.scanKeys];
      return ['0', keys];
    }
    return ['0', []];
  }

  async hmget(key: string, ...fields: string[]): Promise<(string | null)[]> {
    const hash = this.hashes.get(key);
    if (!hash) return fields.map(() => null);
    return fields.map(f => hash[f] ?? null);
  }

  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }

  async set(key: string, value: string): Promise<string> {
    this.store.set(key, value);
    return 'OK';
  }
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('HeartbeatChecker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('triggers when Redis is null (fallback mode)', async () => {
    const result = await shouldTriggerHeartbeat(null);
    expect(result.trigger).toBe(true);
    expect(result.reason).toContain('No Redis');
  });

  it('triggers when pending tasks exist', async () => {
    const redis = new MockRedis();
    redis.addTaskHash('task:abc-123', { status: 'pending', updatedAt: String(Date.now()) });
    // Set last_full to now so failsafe doesn't fire
    await redis.set('heartbeat:last_full', String(Date.now()));

    const result = await shouldTriggerHeartbeat(redis as any);
    expect(result.trigger).toBe(true);
    expect(result.reason).toContain('pending task');
    expect(result.metrics.pending_tasks).toBe(1);
  });

  it('triggers when in_progress tasks exist', async () => {
    const redis = new MockRedis();
    redis.addTaskHash('task:def-456', { status: 'in_progress', updatedAt: String(Date.now()) });
    await redis.set('heartbeat:last_full', String(Date.now()));

    const result = await shouldTriggerHeartbeat(redis as any);
    expect(result.trigger).toBe(true);
    expect(result.metrics.pending_tasks).toBe(1);
  });

  it('triggers when stale tasks exist (>1h in_progress)', async () => {
    const redis = new MockRedis();
    const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;
    redis.addTaskHash('task:stale-1', { status: 'in_progress', updatedAt: String(twoHoursAgo) });
    await redis.set('heartbeat:last_full', String(Date.now()));

    const result = await shouldTriggerHeartbeat(redis as any);
    expect(result.trigger).toBe(true);
    expect(result.metrics.stale_items).toBe(1);
    // Stale in_progress tasks are also counted as pending, so reason may say "pending"
    expect(result.metrics.pending_tasks).toBe(1);
  });

  it('triggers when unprocessed events exist (EventStream)', async () => {
    const redis = new MockRedis();
    await redis.set('heartbeat:last_full', String(Date.now()));
    const mockStream = { pendingCount: vi.fn().mockResolvedValue(5) };

    const result = await shouldTriggerHeartbeat(redis as any, mockStream);
    expect(result.trigger).toBe(true);
    expect(result.reason).toContain('unprocessed event');
    expect(result.metrics.unprocessed_events).toBe(5);
  });

  it('triggers on failsafe when last heartbeat was >12h ago', async () => {
    const redis = new MockRedis();
    const thirteenHoursAgo = Date.now() - 13 * 60 * 60 * 1000;
    await redis.set('heartbeat:last_full', String(thirteenHoursAgo));

    const result = await shouldTriggerHeartbeat(redis as any);
    expect(result.trigger).toBe(true);
    expect(result.reason).toContain('Failsafe');
  });

  it('triggers on failsafe when no previous heartbeat recorded', async () => {
    const redis = new MockRedis();
    // No heartbeat:last_full key set

    const result = await shouldTriggerHeartbeat(redis as any);
    expect(result.trigger).toBe(true);
    expect(result.reason).toContain('Failsafe');
  });

  it('skips when no work and recent heartbeat', async () => {
    const redis = new MockRedis();
    await redis.set('heartbeat:last_full', String(Date.now()));
    // No task hashes added — SCAN returns empty

    const result = await shouldTriggerHeartbeat(redis as any);
    expect(result.trigger).toBe(false);
    expect(result.reason).toContain('No pending work');
  });

  it('skips task:agent:* index keys during scan', async () => {
    const redis = new MockRedis();
    // This is an index key, not a task hash — should be skipped
    redis.addTaskHash('task:agent:builder', { status: 'pending', updatedAt: String(Date.now()) });
    await redis.set('heartbeat:last_full', String(Date.now()));

    const result = await shouldTriggerHeartbeat(redis as any);
    expect(result.trigger).toBe(false);
    expect(result.metrics.pending_tasks).toBe(0);
  });

  it('ignores completed tasks', async () => {
    const redis = new MockRedis();
    redis.addTaskHash('task:done-1', { status: 'completed', updatedAt: String(Date.now()) });
    redis.addTaskHash('task:fail-1', { status: 'failed', updatedAt: String(Date.now()) });
    await redis.set('heartbeat:last_full', String(Date.now()));

    const result = await shouldTriggerHeartbeat(redis as any);
    expect(result.trigger).toBe(false);
    expect(result.metrics.pending_tasks).toBe(0);
  });

  it('persists metrics to Redis', async () => {
    const redis = new MockRedis();
    await redis.set('heartbeat:last_full', String(Date.now()));

    await shouldTriggerHeartbeat(redis as any);

    const metricsJson = await redis.get('heartbeat:metrics:latest');
    expect(metricsJson).toBeTruthy();
    const metrics = JSON.parse(metricsJson!);
    expect(metrics).toHaveProperty('pending_tasks');
    expect(metrics).toHaveProperty('unprocessed_events');
    expect(metrics).toHaveProperty('stale_items');
    expect(metrics).toHaveProperty('checked_at');
    expect(metrics).toHaveProperty('checked_at_ms');
  });

  it('handles EventStream errors gracefully', async () => {
    const redis = new MockRedis();
    await redis.set('heartbeat:last_full', String(Date.now()));
    const mockStream = { pendingCount: vi.fn().mockRejectedValue(new Error('Redis gone')) };

    const result = await shouldTriggerHeartbeat(redis as any, mockStream);
    // Should not throw — returns 0 for unprocessed events
    expect(result.metrics.unprocessed_events).toBe(0);
  });

  it('triggers as fallback when SCAN throws', async () => {
    const redis = {
      scan: vi.fn().mockRejectedValue(new Error('SCAN failed')),
      get: vi.fn().mockResolvedValue(String(Date.now())),
      set: vi.fn().mockResolvedValue('OK'),
    };

    const result = await shouldTriggerHeartbeat(redis as any);
    expect(result.trigger).toBe(true);
    expect(result.reason).toContain('Check failed');
  });
});

describe('recordFullHeartbeat', () => {
  it('persists timestamp to Redis', async () => {
    const redis = new MockRedis();
    const before = Date.now();

    await recordFullHeartbeat(redis as any);

    const val = await redis.get('heartbeat:last_full');
    expect(val).toBeTruthy();
    expect(parseInt(val!, 10)).toBeGreaterThanOrEqual(before);
  });

  it('is a no-op when Redis is null', async () => {
    // Should not throw
    await recordFullHeartbeat(null);
  });
});
