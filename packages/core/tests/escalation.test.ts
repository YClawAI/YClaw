/**
 * Tests for EscalationManager — durable timers via Redis ZSET + Hash.
 *
 * Mocks Redis to test scheduling, cancellation, polling, and
 * at-most-once delivery semantics. Verifies dedup by member key.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ReactionAction, ReactionContext } from '../src/reactions/types.js';

// ─── Mock Redis ──────────────────────────────────────────────────────────────

const mockRedis = {
  zadd: vi.fn().mockResolvedValue(1),
  zrangebyscore: vi.fn().mockResolvedValue([]),
  zrem: vi.fn().mockResolvedValue(1),
  hset: vi.fn().mockResolvedValue(1),
  hget: vi.fn().mockResolvedValue(null),
  hdel: vi.fn().mockResolvedValue(1),
};

vi.mock('ioredis', () => ({
  default: vi.fn(() => mockRedis),
}));

// ─── Mock logger ─────────────────────────────────────────────────────────────

vi.mock('../src/logging/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// ─── Import after mocks ─────────────────────────────────────────────────────

const { EscalationManager } = await import('../src/reactions/escalation.js');

// ─── Test Fixtures ───────────────────────────────────────────────────────────

function makeContext(overrides: Partial<ReactionContext> = {}): ReactionContext {
  return {
    eventType: 'github:ci_fail',
    payload: { branch: 'feature/test' },
    owner: 'yclaw-ai',
    repo: 'yclaw',
    prNumber: 42,
    ...overrides,
  };
}

function makeAction(overrides: Partial<ReactionAction> = {}): ReactionAction {
  return {
    type: 'slack:message',
    params: { channel: '#yclaw-alerts', text: 'Escalation fired' },
    ...overrides,
  };
}

describe('EscalationManager', () => {
  let manager: InstanceType<typeof EscalationManager>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    manager = new EscalationManager(mockRedis as never);
  });

  afterEach(() => {
    manager.stop();
    vi.useRealTimers();
  });

  describe('schedule()', () => {
    it('adds member key to ZSET and entry data to hash', async () => {
      const ctx = makeContext();
      const action = makeAction();
      const now = Date.now();

      await manager.schedule('ci-failed-on-pr', 30 * 60 * 1000, action, ctx);

      // ZSET: member is the dedup key, score is dueAt
      expect(mockRedis.zadd).toHaveBeenCalledTimes(1);
      const [zsetKey, score, member] = mockRedis.zadd.mock.calls[0]!;
      expect(zsetKey).toBe('reaction:escalations');
      expect(member).toBe('ci-failed-on-pr:pr:42');

      const scoreNum = Number(score);
      expect(scoreNum).toBeGreaterThanOrEqual(now + 30 * 60 * 1000);

      // Hash: full entry data keyed by member
      expect(mockRedis.hset).toHaveBeenCalledTimes(1);
      const [hashKey, hashMember, hashValue] = mockRedis.hset.mock.calls[0]!;
      expect(hashKey).toBe('reaction:escalation_data');
      expect(hashMember).toBe('ci-failed-on-pr:pr:42');

      const parsed = JSON.parse(hashValue);
      expect(parsed.ruleId).toBe('ci-failed-on-pr');
      expect(parsed.action).toEqual(action);
      expect(parsed.context).toEqual(ctx);
      expect(parsed.scheduledAt).toBeGreaterThanOrEqual(now);
    });

    it('uses issue number when no PR number', async () => {
      const ctx = makeContext({ prNumber: undefined, issueNumber: 17 });
      const action = makeAction();

      await manager.schedule('test-rule', 5000, action, ctx);

      const member = mockRedis.zadd.mock.calls[0]![2];
      expect(member).toBe('test-rule:issue:17');

      const hashMember = mockRedis.hset.mock.calls[0]![1];
      expect(hashMember).toBe('test-rule:issue:17');
    });

    it('uses "unknown" when neither PR nor issue number', async () => {
      const ctx = makeContext({ prNumber: undefined, issueNumber: undefined });
      const action = makeAction();

      await manager.schedule('test-rule', 5000, action, ctx);

      const member = mockRedis.zadd.mock.calls[0]![2];
      expect(member).toBe('test-rule:issue:unknown');
    });

    it('replaces existing entry when same ruleId:resource is scheduled again', async () => {
      const ctx = makeContext({ prNumber: 42 });
      const action1 = makeAction({ params: { text: 'first' } });
      const action2 = makeAction({ params: { text: 'second' } });

      await manager.schedule('ci-failed-on-pr', 30_000, action1, ctx);
      await manager.schedule('ci-failed-on-pr', 60_000, action2, ctx);

      // Both calls use the same member key — Redis zadd replaces the score
      expect(mockRedis.zadd).toHaveBeenCalledTimes(2);
      expect(mockRedis.zadd.mock.calls[0]![2]).toBe('ci-failed-on-pr:pr:42');
      expect(mockRedis.zadd.mock.calls[1]![2]).toBe('ci-failed-on-pr:pr:42');

      // Hash is overwritten with the latest entry
      expect(mockRedis.hset).toHaveBeenCalledTimes(2);
      const lastEntry = JSON.parse(mockRedis.hset.mock.calls[1]![2]);
      expect(lastEntry.action.params.text).toBe('second');
    });
  });

  describe('cancel()', () => {
    it('removes entry from ZSET and hash by member key', async () => {
      const ctx = makeContext({ prNumber: 42 });

      // zrem returns 1 (entry existed)
      mockRedis.zrem.mockResolvedValueOnce(1);

      await manager.cancel('ci-failed-on-pr', ctx);

      expect(mockRedis.zrem).toHaveBeenCalledWith(
        'reaction:escalations',
        'ci-failed-on-pr:pr:42',
      );
      expect(mockRedis.hdel).toHaveBeenCalledWith(
        'reaction:escalation_data',
        'ci-failed-on-pr:pr:42',
      );
    });

    it('handles cancel when no entry exists (no-op)', async () => {
      const ctx = makeContext({ prNumber: 99 });

      // zrem returns 0 (no entry)
      mockRedis.zrem.mockResolvedValueOnce(0);

      await manager.cancel('ci-failed-on-pr', ctx);

      expect(mockRedis.zrem).toHaveBeenCalledWith(
        'reaction:escalations',
        'ci-failed-on-pr:pr:99',
      );
      // hdel still called (idempotent cleanup)
      expect(mockRedis.hdel).toHaveBeenCalledWith(
        'reaction:escalation_data',
        'ci-failed-on-pr:pr:99',
      );
    });
  });

  describe('start() / stop()', () => {
    it('starts polling and can be stopped', () => {
      manager.start();
      // Starting again should be a no-op
      manager.start();

      manager.stop();
      // Stopping again should be a no-op
      manager.stop();
    });
  });

  describe('processDue (via start)', () => {
    it('fires executor for due escalations', async () => {
      const executor = vi.fn().mockResolvedValue(undefined);
      manager.onEscalation(executor);

      const entry = {
        ruleId: 'ci-failed-on-pr',
        action: makeAction(),
        context: makeContext(),
        scheduledAt: Date.now() - 60_000,
      };

      // ZSET returns member keys (not JSON)
      mockRedis.zrangebyscore.mockResolvedValueOnce(['ci-failed-on-pr:pr:42']);
      // Hash returns entry data
      mockRedis.hget.mockResolvedValueOnce(JSON.stringify(entry));

      manager.start();

      // Allow the immediate processDue to run
      await vi.advanceTimersByTimeAsync(0);

      expect(executor).toHaveBeenCalledTimes(1);
      expect(executor).toHaveBeenCalledWith(entry.action, entry.context);
      expect(mockRedis.zrem).toHaveBeenCalledWith('reaction:escalations', 'ci-failed-on-pr:pr:42');
      expect(mockRedis.hdel).toHaveBeenCalledWith('reaction:escalation_data', 'ci-failed-on-pr:pr:42');
    });

    it('removes entry even if executor throws', async () => {
      const executor = vi.fn().mockRejectedValue(new Error('executor failed'));
      manager.onEscalation(executor);

      const entry = {
        ruleId: 'test-rule',
        action: makeAction(),
        context: makeContext(),
        scheduledAt: Date.now() - 1000,
      };

      mockRedis.zrangebyscore.mockResolvedValueOnce(['test-rule:pr:42']);
      mockRedis.hget.mockResolvedValueOnce(JSON.stringify(entry));

      manager.start();
      await vi.advanceTimersByTimeAsync(0);

      // Entry removed even on failure (at-most-once delivery)
      expect(mockRedis.zrem).toHaveBeenCalledWith('reaction:escalations', 'test-rule:pr:42');
      // Hash cleanup attempted
      expect(mockRedis.hdel).toHaveBeenCalled();
    });

    it('skips entry when hash data is missing (orphaned ZSET member)', async () => {
      const executor = vi.fn();
      manager.onEscalation(executor);

      mockRedis.zrangebyscore.mockResolvedValueOnce(['orphan-rule:pr:42']);
      mockRedis.hget.mockResolvedValueOnce(null);

      manager.start();
      await vi.advanceTimersByTimeAsync(0);

      // Executor should NOT be called — no data to execute
      expect(executor).not.toHaveBeenCalled();
      // ZSET entry still removed to prevent infinite retry
      expect(mockRedis.zrem).toHaveBeenCalledWith('reaction:escalations', 'orphan-rule:pr:42');
    });

    it('warns when no executor is registered', async () => {
      // Don't call onEscalation — no executor registered
      const entry = {
        ruleId: 'test-rule',
        action: makeAction(),
        context: makeContext(),
        scheduledAt: Date.now() - 1000,
      };

      mockRedis.zrangebyscore.mockResolvedValueOnce(['test-rule:pr:42']);
      mockRedis.hget.mockResolvedValueOnce(JSON.stringify(entry));

      manager.start();
      await vi.advanceTimersByTimeAsync(0);

      // Entry removed from ZSET
      expect(mockRedis.zrem).toHaveBeenCalledWith('reaction:escalations', 'test-rule:pr:42');
    });

    it('does nothing when no due escalations', async () => {
      const executor = vi.fn();
      manager.onEscalation(executor);

      mockRedis.zrangebyscore.mockResolvedValueOnce([]);

      manager.start();
      await vi.advanceTimersByTimeAsync(0);

      expect(executor).not.toHaveBeenCalled();
    });
  });
});
