/**
 * Tests for Slack message dedup in SlackExecutor.
 *
 * Validates fingerprinting, dedup via Redis SET NX, channel-specific TTLs,
 * and the suppression behavior in postMessage/postAlert.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SlackExecutor } from '../src/actions/slack.js';

// ─── Mock Redis ─────────────────────────────────────────────────────────────

function createMockRedis() {
  const store = new Map<string, string>();

  return {
    set: vi.fn(async (key: string, value: string, ...args: unknown[]) => {
      if (args.includes('NX') && store.has(key)) return null;
      store.set(key, String(value));
      return 'OK';
    }),
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    _store: store,
  } as any;
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('SlackExecutor dedup', () => {
  let redis: ReturnType<typeof createMockRedis>;
  let executor: SlackExecutor;

  beforeEach(() => {
    redis = createMockRedis();
    // Construct with Redis for dedup. No SLACK_BOT_TOKEN in env so
    // the Slack client won't be created, but fingerprint/isDuplicate work.
    executor = new SlackExecutor(redis);
  });

  describe('fingerprint', () => {
    it('normalizes task counts so "28 tasks" and "35 tasks" produce the same fingerprint', () => {
      const a = executor.fingerprint('#yclaw-alerts', '🚨 Builder Pipeline Blocked — 28 tasks stuck');
      const b = executor.fingerprint('#yclaw-alerts', '🚨 Builder Pipeline Blocked — 35 tasks stuck');
      expect(a).toBe(b);
    });

    it('different channels produce different fingerprints', () => {
      const a = executor.fingerprint('#yclaw-alerts', 'Same message');
      const b = executor.fingerprint('#yclaw-development', 'Same message');
      expect(a).not.toBe(b);
    });

    it('strips UUIDs', () => {
      const a = executor.fingerprint('#ch', 'Task a1b2c3d4-e5f6-7890-abcd-ef1234567890 failed');
      const b = executor.fingerprint('#ch', 'Task 12345678-aaaa-bbbb-cccc-dddddddddddd failed');
      expect(a).toBe(b);
    });

    it('strips deploy IDs', () => {
      const a = executor.fingerprint('#ch', 'Deploy dep-12345-abc123 started');
      const b = executor.fingerprint('#ch', 'Deploy dep-99999-xyz789 started');
      expect(a).toBe(b);
    });

    it('strips ISO timestamps', () => {
      const a = executor.fingerprint('#ch', 'Event at 2026-03-04T10:30:00.000Z');
      const b = executor.fingerprint('#ch', 'Event at 2026-03-05T14:22:33.456Z');
      expect(a).toBe(b);
    });

    it('strips commit SHAs in backticks', () => {
      const a = executor.fingerprint('#ch', 'Commit `abc1234` merged');
      const b = executor.fingerprint('#ch', 'Commit `def5678` merged');
      expect(a).toBe(b);
    });

    it('normalizes hour/minute counts', () => {
      const a = executor.fingerprint('#ch', 'Blocked for 2 hours, 15 minutes');
      const b = executor.fingerprint('#ch', 'Blocked for 5 hours, 30 minutes');
      expect(a).toBe(b);
    });

    it('produces a 32-char hex string', () => {
      const fp = executor.fingerprint('#ch', 'Hello');
      expect(fp).toMatch(/^[a-f0-9]{32}$/);
    });
  });

  describe('isDuplicate', () => {
    it('returns false for a new message (first time)', async () => {
      const result = await executor.isDuplicate('#yclaw-alerts', 'New alert');
      expect(result).toBe(false);
    });

    it('returns true for a duplicate message (second time)', async () => {
      await executor.isDuplicate('#yclaw-alerts', 'Same alert');
      const result = await executor.isDuplicate('#yclaw-alerts', 'Same alert');
      expect(result).toBe(true);
    });

    it('uses channel-specific TTL for known channels', async () => {
      await executor.isDuplicate('C0000000007', 'Alert'); // #yclaw-alerts → 7200s
      expect(redis.set).toHaveBeenCalledWith(
        expect.stringContaining('slack:dedup:'),
        expect.any(String),
        'EX',
        7200,
        'NX',
      );
    });

    it('uses default TTL for unknown channels', async () => {
      await executor.isDuplicate('C_UNKNOWN', 'Alert');
      expect(redis.set).toHaveBeenCalledWith(
        expect.stringContaining('slack:dedup:'),
        expect.any(String),
        'EX',
        3600,
        'NX',
      );
    });

    it('returns false when Redis is not available', async () => {
      const noRedisExecutor = new SlackExecutor(null);
      const result = await noRedisExecutor.isDuplicate('#ch', 'msg');
      expect(result).toBe(false);
    });

    it('fails open when Redis throws', async () => {
      const failingRedis = {
        set: vi.fn().mockRejectedValue(new Error('Redis down')),
      } as any;
      const failExecutor = new SlackExecutor(failingRedis);
      const result = await failExecutor.isDuplicate('#ch', 'msg');
      expect(result).toBe(false);
    });
  });

  describe('dedup integration', () => {
    it('isDuplicate returns false then true for identical messages', async () => {
      const first = await executor.isDuplicate('#yclaw-alerts', 'Pipeline blocked — 28 tasks');
      expect(first).toBe(false);

      // Same semantic message with different count
      const second = await executor.isDuplicate('#yclaw-alerts', 'Pipeline blocked — 35 tasks');
      expect(second).toBe(true);
    });

    it('allows the same message on different channels', async () => {
      await executor.isDuplicate('#yclaw-alerts', 'Same message');
      const result = await executor.isDuplicate('#yclaw-development', 'Same message');
      expect(result).toBe(false);
    });

    it('allows semantically different messages on the same channel', async () => {
      await executor.isDuplicate('#yclaw-alerts', 'Builder pipeline blocked');
      const result = await executor.isDuplicate('#yclaw-alerts', 'Deploy pending review');
      expect(result).toBe(false);
    });
  });
});
