/**
 * Tests for the Elvis pre-check — deterministic (zero-LLM) heartbeat gate.
 *
 * Spec §8 (heartbeat-precheck):
 *   1. shouldRun=false when queue empty + no events + no alerts + within silence interval
 *   2. shouldRun=true when queue has tasks
 *   3. shouldRun=true when max silence interval exceeded
 *   4. shouldRun=true when unprocessed events exist
 *   5. Architect: shouldRun=true when PRs awaiting review (github/builder stream events)
 *   6. Sentinel: shouldRun=true when active alerts
 *   7. Strategist excluded — handled at bootstrap layer (precheckEnabled = agent !== 'strategist')
 *   8. Redis failure → shouldRun=true (fail-open)
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

const { shouldRunHeartbeat, recordHeartbeatRun } = await import(
  '../src/services/heartbeat-precheck.js'
);

// ─── In-Memory Redis Mock ───────────────────────────────────────────────────

class MockRedis {
  private strings = new Map<string, string>();
  private zsets = new Map<string, number>(); // key → cardinality

  set(key: string, value: string): Promise<string> {
    this.strings.set(key, value);
    return Promise.resolve('OK');
  }

  get(key: string): Promise<string | null> {
    return Promise.resolve(this.strings.get(key) ?? null);
  }

  /** Pre-populate a ZSET with a given cardinality (for zcard). */
  addZSet(key: string, count: number) {
    this.zsets.set(key, count);
  }

  zcard(key: string): Promise<number> {
    return Promise.resolve(this.zsets.get(key) ?? 0);
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeStream(pendingMap: Record<string, number> = {}): { pendingCount: ReturnType<typeof vi.fn> } {
  return {
    pendingCount: vi.fn().mockImplementation(async (prefix?: string) => {
      if (prefix === undefined) {
        // Sum all entries for the general count
        return Object.values(pendingMap).reduce((sum, n) => sum + n, 0);
      }
      return pendingMap[prefix] ?? 0;
    }),
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('shouldRunHeartbeat', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Test 8: fail-open on missing Redis
  it('returns shouldRun=true when Redis is null (fail-open)', async () => {
    const result = await shouldRunHeartbeat('builder', null);
    expect(result.shouldRun).toBe(true);
    expect(result.reasons[0]).toContain('No Redis');
  });

  // Test 1: skip when nothing to do and ran recently
  it('returns shouldRun=false when queue empty, no events, no alerts, within silence interval', async () => {
    const redis = new MockRedis();
    await redis.set('precheck:last_full:builder', String(Date.now()));

    const result = await shouldRunHeartbeat('builder', redis as any);
    expect(result.shouldRun).toBe(false);
    expect(result.skipReason).toContain('no pending work');
    expect(result.reasons).toHaveLength(0);
  });

  // Test 2: shouldRun=true when Builder queue has tasks
  it('returns shouldRun=true when builder task queue has tasks', async () => {
    const redis = new MockRedis();
    await redis.set('precheck:last_full:builder', String(Date.now()));
    redis.addZSet('builder:task_queue:P1', 2);

    const result = await shouldRunHeartbeat('builder', redis as any);
    expect(result.shouldRun).toBe(true);
    expect(result.reasons.some(r => r.includes('task(s) in queue'))).toBe(true);
  });

  it('returns shouldRun=true when builder P0 safety queue has tasks', async () => {
    const redis = new MockRedis();
    await redis.set('precheck:last_full:builder', String(Date.now()));
    redis.addZSet('builder:task_queue:P0', 1);

    const result = await shouldRunHeartbeat('builder', redis as any);
    expect(result.shouldRun).toBe(true);
  });

  it('returns shouldRun=true when non-builder agent task index has tasks', async () => {
    const redis = new MockRedis();
    await redis.set('precheck:last_full:architect', String(Date.now()));
    redis.addZSet('task:agent:architect', 3);

    const result = await shouldRunHeartbeat('architect', redis as any);
    expect(result.shouldRun).toBe(true);
    expect(result.reasons.some(r => r.includes('task(s) in queue'))).toBe(true);
  });

  // Test 3: shouldRun=true when max silence exceeded
  it('returns shouldRun=true when max silence interval exceeded', async () => {
    const redis = new MockRedis();
    const sevenHoursAgo = Date.now() - 7 * 60 * 60 * 1000;
    await redis.set('precheck:last_full:sentinel', String(sevenHoursAgo));

    const result = await shouldRunHeartbeat('sentinel', redis as any);
    expect(result.shouldRun).toBe(true);
    expect(result.reasons.some(r => r.includes('max silence exceeded'))).toBe(true);
  });

  it('returns shouldRun=true when agent has never run (no last_full key)', async () => {
    const redis = new MockRedis();
    // No precheck:last_full key set

    const result = await shouldRunHeartbeat('designer', redis as any);
    expect(result.shouldRun).toBe(true);
    expect(result.reasons.some(r => r.includes('max silence exceeded'))).toBe(true);
    expect(result.reasons.some(r => r.includes('never run'))).toBe(true);
  });

  it('respects custom maxSilenceMs option', async () => {
    const redis = new MockRedis();
    // Ran 30 minutes ago
    const thirtyMinutesAgo = Date.now() - 30 * 60 * 1000;
    await redis.set('precheck:last_full:builder', String(thirtyMinutesAgo));

    // With 1-hour silence limit — 30min ago is within limit → skip
    const resultSkip = await shouldRunHeartbeat('builder', redis as any, null, { maxSilenceMs: 60 * 60 * 1000 });
    expect(resultSkip.shouldRun).toBe(false);

    // With 15-minute silence limit — 30min ago exceeds limit → run
    const resultRun = await shouldRunHeartbeat('builder', redis as any, null, { maxSilenceMs: 15 * 60 * 1000 });
    expect(resultRun.shouldRun).toBe(true);
    expect(resultRun.reasons.some(r => r.includes('max silence exceeded'))).toBe(true);
  });

  // Test 4: shouldRun=true when unprocessed events exist
  it('returns shouldRun=true when unprocessed events exist', async () => {
    const redis = new MockRedis();
    await redis.set('precheck:last_full:deployer', String(Date.now()));
    const stream = makeStream({ general: 4 });

    const result = await shouldRunHeartbeat('deployer', redis as any, stream as any);
    expect(result.shouldRun).toBe(true);
    expect(result.reasons.some(r => r.includes('unprocessed event'))).toBe(true);
  });

  // Test 5: Architect — pending PR reviews
  it('Architect: returns shouldRun=true when PRs awaiting review (github stream events)', async () => {
    const redis = new MockRedis();
    await redis.set('precheck:last_full:architect', String(Date.now()));
    // Pending github:pr_opened events
    const stream = makeStream({ github: 2 });

    const result = await shouldRunHeartbeat('architect', redis as any, stream as any);
    expect(result.shouldRun).toBe(true);
    expect(result.reasons.some(r => r.includes('pending PR event'))).toBe(true);
  });

  it('Architect: returns shouldRun=true when builder:pr_ready events pending', async () => {
    const redis = new MockRedis();
    await redis.set('precheck:last_full:architect', String(Date.now()));
    const stream = makeStream({ builder: 1 });

    const result = await shouldRunHeartbeat('architect', redis as any, stream as any);
    expect(result.shouldRun).toBe(true);
    expect(result.reasons.some(r => r.includes('pending PR event'))).toBe(true);
  });

  it('Architect: returns shouldRun=false when no PR events and no other work', async () => {
    const redis = new MockRedis();
    await redis.set('precheck:last_full:architect', String(Date.now()));
    const stream = makeStream({}); // no events

    const result = await shouldRunHeartbeat('architect', redis as any, stream as any);
    expect(result.shouldRun).toBe(false);
  });

  // Test 6: Sentinel — active alerts
  it('Sentinel: returns shouldRun=true when active alerts exist', async () => {
    const redis = new MockRedis();
    await redis.set('precheck:last_full:sentinel', String(Date.now()));
    await redis.set('sentinel:active_alerts', '3');

    const result = await shouldRunHeartbeat('sentinel', redis as any);
    expect(result.shouldRun).toBe(true);
    expect(result.reasons.some(r => r.includes('active alert'))).toBe(true);
  });

  it('Sentinel: returns shouldRun=false when no alerts and quiet', async () => {
    const redis = new MockRedis();
    await redis.set('precheck:last_full:sentinel', String(Date.now()));
    // No sentinel:active_alerts key set

    const result = await shouldRunHeartbeat('sentinel', redis as any);
    expect(result.shouldRun).toBe(false);
  });

  it('Sentinel: ignores sentinel:active_alerts = 0', async () => {
    const redis = new MockRedis();
    await redis.set('precheck:last_full:sentinel', String(Date.now()));
    await redis.set('sentinel:active_alerts', '0');

    const result = await shouldRunHeartbeat('sentinel', redis as any);
    expect(result.shouldRun).toBe(false);
  });

  // Test 7: Strategist exclusion is at the bootstrap layer, not in the service itself
  // The service does NOT exclude Strategist — the bootstrap agent !== 'strategist' check does.
  // This verifies that shouldRunHeartbeat treats Strategist like any other agent (no special-casing).
  it('service does not special-case Strategist (exclusion is at bootstrap layer)', async () => {
    const redis = new MockRedis();
    await redis.set('precheck:last_full:strategist', String(Date.now()));

    // With empty queues and recent run, shouldRun=false — Strategist is treated normally here
    const result = await shouldRunHeartbeat('strategist', redis as any);
    expect(result.shouldRun).toBe(false);
    expect(result.skipReason).toBe('no pending work');
  });

  // Test 8: Redis failure → fail-open
  it('returns shouldRun=true when Redis throws (fail-open)', async () => {
    const badRedis = {
      zcard: vi.fn().mockRejectedValue(new Error('Connection refused')),
      get: vi.fn().mockRejectedValue(new Error('Connection refused')),
      set: vi.fn().mockRejectedValue(new Error('Connection refused')),
    };

    const result = await shouldRunHeartbeat('builder', badRedis as any);
    expect(result.shouldRun).toBe(true);
    // Fail-open: should run regardless of the specific reason message
    expect(result.shouldRun).toBe(true);
  });

  it('handles EventStream errors gracefully (does not throw)', async () => {
    const redis = new MockRedis();
    await redis.set('precheck:last_full:builder', String(Date.now()));
    const brokenStream = {
      pendingCount: vi.fn().mockRejectedValue(new Error('Stream unavailable')),
    };

    // Should not throw — treats unprocessed events as 0
    const result = await shouldRunHeartbeat('builder', redis as any, brokenStream as any);
    expect(result.shouldRun).toBe(false);
  });

  it('accumulates multiple reasons when several signals fire', async () => {
    const redis = new MockRedis();
    // Agent ran long ago (max silence exceeded)
    await redis.set('precheck:last_full:builder', String(Date.now() - 8 * 60 * 60 * 1000));
    redis.addZSet('builder:task_queue:P2', 5);
    const stream = makeStream({ builder: 2 });

    const result = await shouldRunHeartbeat('builder', redis as any, stream as any);
    expect(result.shouldRun).toBe(true);
    expect(result.reasons.length).toBeGreaterThanOrEqual(2);
  });
});

// ─── recordHeartbeatRun ──────────────────────────────────────────────────────

describe('recordHeartbeatRun', () => {
  it('writes timestamp to Redis', async () => {
    const redis = new MockRedis();
    const before = Date.now();

    await recordHeartbeatRun('builder', redis as any);

    const val = await redis.get('precheck:last_full:builder');
    expect(val).not.toBeNull();
    expect(parseInt(val!, 10)).toBeGreaterThanOrEqual(before);
  });

  it('uses per-agent key', async () => {
    const redis = new MockRedis();
    await recordHeartbeatRun('sentinel', redis as any);
    await recordHeartbeatRun('architect', redis as any);

    const sentinelVal = await redis.get('precheck:last_full:sentinel');
    const architectVal = await redis.get('precheck:last_full:architect');
    expect(sentinelVal).not.toBeNull();
    expect(architectVal).not.toBeNull();
    // Both keys exist independently — they may have same timestamp if called in same ms
    expect(await redis.get('precheck:last_full:sentinel')).toBeTruthy();
    expect(await redis.get('precheck:last_full:architect')).toBeTruthy();
  });

  it('is a no-op when Redis is null', async () => {
    // Must not throw
    await recordHeartbeatRun('builder', null);
  });

  it('swallows Redis errors silently', async () => {
    const badRedis = {
      set: vi.fn().mockRejectedValue(new Error('Connection refused')),
    };
    // Must not throw
    await recordHeartbeatRun('builder', badRedis as any);
  });
});
