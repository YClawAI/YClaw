import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TaskLockManager } from '../src/operators/task-locks.js';

// Mock Redis with in-memory hash storage
function createMockRedis() {
  const store = new Map<string, Record<string, string>>();
  const ttls = new Map<string, number>();

  return {
    _store: store,
    eval: vi.fn().mockImplementation(async (script: string, numKeys: number, key: string, ...args: string[]) => {
      const scriptStr = script as string;

      if (scriptStr.includes('HGETALL') && scriptStr.includes('acquired')) {
        // Acquire script
        const [taskId, operatorId, priority, acquiredAt, expiresAt, ttl] = args;
        const existing = store.get(key);

        if (!existing) {
          store.set(key, { taskId: taskId!, operatorId: operatorId!, priority: priority!, acquiredAt: acquiredAt!, expiresAt: expiresAt! });
          ttls.set(key, parseInt(ttl!, 10));
          return ['acquired', '', '', '', '', ''];
        }

        const existingPriority = parseInt(existing.priority!, 10);
        const newPriority = parseInt(priority!, 10);

        if (newPriority > existingPriority) {
          const preempted = [existing.taskId, existing.operatorId, existing.priority, existing.acquiredAt, existing.expiresAt];
          store.set(key, { taskId: taskId!, operatorId: operatorId!, priority: priority!, acquiredAt: acquiredAt!, expiresAt: expiresAt! });
          ttls.set(key, parseInt(ttl!, 10));
          return ['preempted', ...preempted];
        }

        return ['blocked', existing.taskId, existing.operatorId, existing.priority, existing.acquiredAt, existing.expiresAt];
      }

      if (scriptStr.includes('holder') && !scriptStr.includes('additionalSeconds')) {
        // Release script
        const [operatorId] = args;
        const existing = store.get(key);
        if (!existing) return 0;
        if (existing.operatorId !== operatorId) return -1;
        store.delete(key);
        return 1;
      }

      if (scriptStr.includes('additionalSeconds')) {
        // Extend script
        const [operatorId] = args;
        const existing = store.get(key);
        if (!existing) return 0;
        if (existing.operatorId !== operatorId) return -1;
        return 1;
      }

      return null;
    }),
    hgetall: vi.fn().mockImplementation(async (key: string) => {
      return store.get(key) || {};
    }),
    keys: vi.fn().mockImplementation(async (pattern: string) => {
      const prefix = pattern.replace('*', '');
      return [...store.keys()].filter((k) => k.startsWith(prefix));
    }),
    del: vi.fn().mockImplementation(async (key: string) => {
      if (store.has(key)) {
        store.delete(key);
        return 1;
      }
      return 0;
    }),
  };
}

describe('TaskLockManager', () => {
  let redis: ReturnType<typeof createMockRedis>;
  let lockManager: TaskLockManager;

  beforeEach(() => {
    redis = createMockRedis();
    lockManager = new TaskLockManager(redis as any);
  });

  describe('acquireLock', () => {
    it('acquires a lock on an uncontested resource', async () => {
      const result = await lockManager.acquireLock({
        resourceKey: 'marketing:campaign:q2',
        taskId: 'task_1',
        operatorId: 'op_cmo',
        priority: 70,
      });

      expect(result.acquired).toBe(true);
      expect(result.preempted).toBeUndefined();
      expect(result.currentHolder).toBeUndefined();
    });

    it('blocks when same-priority holder exists', async () => {
      await lockManager.acquireLock({
        resourceKey: 'marketing:campaign:q2',
        taskId: 'task_1',
        operatorId: 'op_cmo',
        priority: 70,
      });

      const result = await lockManager.acquireLock({
        resourceKey: 'marketing:campaign:q2',
        taskId: 'task_2',
        operatorId: 'op_contributor',
        priority: 50,
      });

      expect(result.acquired).toBe(false);
      expect(result.currentHolder).toBeDefined();
      expect(result.currentHolder!.operatorId).toBe('op_cmo');
    });

    it('preempts when higher priority submits', async () => {
      await lockManager.acquireLock({
        resourceKey: 'marketing:campaign:q2',
        taskId: 'task_1',
        operatorId: 'op_contributor',
        priority: 50,
      });

      const result = await lockManager.acquireLock({
        resourceKey: 'marketing:campaign:q2',
        taskId: 'task_2',
        operatorId: 'op_ceo',
        priority: 100,
      });

      expect(result.acquired).toBe(true);
      expect(result.preempted).toBeDefined();
      expect(result.preempted!.operatorId).toBe('op_contributor');
      expect(result.preempted!.priority).toBe(50);
    });
  });

  describe('releaseLock', () => {
    it('releases a lock held by the operator', async () => {
      await lockManager.acquireLock({
        resourceKey: 'res_1', taskId: 'task_1', operatorId: 'op_a', priority: 50,
      });

      const released = await lockManager.releaseLock('res_1', 'op_a');
      expect(released).toBe(true);
    });

    it('refuses to release a lock held by another operator', async () => {
      await lockManager.acquireLock({
        resourceKey: 'res_1', taskId: 'task_1', operatorId: 'op_a', priority: 50,
      });

      const released = await lockManager.releaseLock('res_1', 'op_b');
      expect(released).toBe(false);
    });

    it('returns false for non-existent lock', async () => {
      const released = await lockManager.releaseLock('nonexistent', 'op_a');
      expect(released).toBe(false);
    });
  });

  describe('forceRelease', () => {
    it('force-releases a lock regardless of holder', async () => {
      await lockManager.acquireLock({
        resourceKey: 'res_1', taskId: 'task_1', operatorId: 'op_a', priority: 50,
      });

      const released = await lockManager.forceRelease('res_1');
      expect(released).toBe(true);
    });

    it('returns false for non-existent lock', async () => {
      const released = await lockManager.forceRelease('nonexistent');
      expect(released).toBe(false);
    });
  });

  describe('getLock', () => {
    it('returns lock info for a held resource', async () => {
      await lockManager.acquireLock({
        resourceKey: 'res_1', taskId: 'task_1', operatorId: 'op_a', priority: 50,
      });

      const lock = await lockManager.getLock('res_1');
      expect(lock).not.toBeNull();
      expect(lock!.operatorId).toBe('op_a');
      expect(lock!.priority).toBe(50);
    });

    it('returns null for unheld resource', async () => {
      const lock = await lockManager.getLock('nonexistent');
      expect(lock).toBeNull();
    });
  });

  describe('listLocks', () => {
    it('lists all active locks', async () => {
      await lockManager.acquireLock({
        resourceKey: 'res_1', taskId: 'task_1', operatorId: 'op_a', priority: 50,
      });
      await lockManager.acquireLock({
        resourceKey: 'res_2', taskId: 'task_2', operatorId: 'op_b', priority: 70,
      });

      const locks = await lockManager.listLocks();
      expect(locks).toHaveLength(2);
    });
  });
});
