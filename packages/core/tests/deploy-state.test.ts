import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TaskState } from '../src/builder/types.js';
import {
  classifyDrainTermination,
  isCountableFailure,
  flushStaleTaskState,
} from '../src/builder/deploy-state.js';

// ─── classifyDrainTermination ───────────────────────────────────────────────

describe('classifyDrainTermination', () => {
  it('preserves COMPLETED state', () => {
    const result = classifyDrainTermination(TaskState.COMPLETED);
    expect(result.newState).toBe(TaskState.COMPLETED);
    expect(result.failureReason).toBeUndefined();
  });

  it('preserves FAILED state', () => {
    const result = classifyDrainTermination(TaskState.FAILED);
    expect(result.newState).toBe(TaskState.FAILED);
    expect(result.failureReason).toBeUndefined();
  });

  it('preserves TIMEOUT state', () => {
    const result = classifyDrainTermination(TaskState.TIMEOUT);
    expect(result.newState).toBe(TaskState.TIMEOUT);
    expect(result.failureReason).toBeUndefined();
  });

  it('preserves SKIPPED state', () => {
    const result = classifyDrainTermination(TaskState.SKIPPED);
    expect(result.newState).toBe(TaskState.SKIPPED);
    expect(result.failureReason).toBeUndefined();
  });

  it('preserves REQUEUED state', () => {
    const result = classifyDrainTermination(TaskState.REQUEUED);
    expect(result.newState).toBe(TaskState.REQUEUED);
    expect(result.failureReason).toBeUndefined();
  });

  it('marks RUNNING as REQUEUED with sigterm', () => {
    const result = classifyDrainTermination(TaskState.RUNNING);
    expect(result.newState).toBe(TaskState.REQUEUED);
    expect(result.failureReason).toBe('sigterm');
  });

  it('marks ASSIGNED as REQUEUED with sigterm', () => {
    const result = classifyDrainTermination(TaskState.ASSIGNED);
    expect(result.newState).toBe(TaskState.REQUEUED);
    expect(result.failureReason).toBe('sigterm');
  });

  it('marks QUEUED as REQUEUED with sigterm', () => {
    const result = classifyDrainTermination(TaskState.QUEUED);
    expect(result.newState).toBe(TaskState.REQUEUED);
    expect(result.failureReason).toBe('sigterm');
  });
});

// ─── isCountableFailure ─────────────────────────────────────────────────────

describe('isCountableFailure', () => {
  it('counts FAILED without failureReason', () => {
    expect(isCountableFailure(TaskState.FAILED)).toBe(true);
  });

  it('counts TIMEOUT without failureReason', () => {
    expect(isCountableFailure(TaskState.TIMEOUT)).toBe(true);
  });

  it('counts FAILED with error reason', () => {
    expect(isCountableFailure(TaskState.FAILED, 'error')).toBe(true);
  });

  it('counts TIMEOUT with timeout reason', () => {
    expect(isCountableFailure(TaskState.TIMEOUT, 'timeout')).toBe(true);
  });

  it('does NOT count FAILED with sigterm reason', () => {
    expect(isCountableFailure(TaskState.FAILED, 'sigterm')).toBe(false);
  });

  it('does NOT count TIMEOUT with sigterm reason', () => {
    expect(isCountableFailure(TaskState.TIMEOUT, 'sigterm')).toBe(false);
  });

  it('does NOT count COMPLETED', () => {
    expect(isCountableFailure(TaskState.COMPLETED)).toBe(false);
  });

  it('does NOT count REQUEUED', () => {
    expect(isCountableFailure(TaskState.REQUEUED)).toBe(false);
  });

  it('does NOT count SKIPPED', () => {
    expect(isCountableFailure(TaskState.SKIPPED)).toBe(false);
  });

  it('counts FAILED with circuit_breaker reason', () => {
    expect(isCountableFailure(TaskState.FAILED, 'circuit_breaker')).toBe(true);
  });
});

// ─── flushStaleTaskState ────────────────────────────────────────────────────

describe('flushStaleTaskState', () => {
  const STALE_AGE_MS = 4 * 60 * 60 * 1000; // 4 hours
  const now = Date.now();
  const staleTime = new Date(now - STALE_AGE_MS - 60_000).toISOString(); // 4h1m ago
  const freshTime = new Date(now - 60_000).toISOString(); // 1m ago

  function makeMockRedis(taskData: Record<string, Record<string, string>>, dlqEntries: string[] = []) {
    const taskKeys = Object.keys(taskData);
    const removedFromQueues = new Map<string, Set<string>>();

    return {
      scan: vi.fn()
        .mockResolvedValueOnce([
          '0', // cursor=0 means done
          taskKeys,
        ]),
      hgetall: vi.fn().mockImplementation((key: string) => {
        return Promise.resolve(taskData[key] ?? {});
      }),
      del: vi.fn().mockResolvedValue(1),
      zrem: vi.fn().mockImplementation((queueKey: string, taskId: string) => {
        if (!removedFromQueues.has(queueKey)) removedFromQueues.set(queueKey, new Set());
        removedFromQueues.get(queueKey)!.add(taskId);
        return Promise.resolve(1);
      }),
      llen: vi.fn().mockResolvedValue(dlqEntries.length),
      lrange: vi.fn().mockResolvedValue(dlqEntries),
      rpush: vi.fn().mockResolvedValue(dlqEntries.length),
      multi: vi.fn().mockReturnValue({
        del: vi.fn().mockReturnThis(),
        rpush: vi.fn().mockReturnThis(),
        exec: vi.fn().mockResolvedValue([]),
      }),
      _removedFromQueues: removedFromQueues,
    };
  }

  it('deletes stale non-terminal tasks and removes from queues', async () => {
    const taskData: Record<string, Record<string, string>> = {
      'builder:task:abc': { state: 'running', createdAt: staleTime },
      'builder:task:def': { state: 'completed', createdAt: staleTime },
      'builder:task:ghi': { state: 'queued', createdAt: freshTime },
    };

    const redis = makeMockRedis(taskData);
    const result = await flushStaleTaskState(
      redis as never,
      'builder:task:',
      'builder:task_queue',
      'builder:dlq',
      STALE_AGE_MS,
    );

    // Only 'abc' (running + stale) should be deleted; 'def' (completed) and 'ghi' (fresh) preserved
    expect(result.tasksDeleted).toBe(1);
    expect(redis.del).toHaveBeenCalledWith('builder:task:abc');
    // Should attempt removal from all 4 priority queues
    expect(redis.zrem).toHaveBeenCalledTimes(4);
  });

  it('prunes stale DLQ entries', async () => {
    const freshDlq = JSON.stringify({ failedAt: freshTime, taskName: 'fresh' });
    const staleDlq = JSON.stringify({ failedAt: staleTime, taskName: 'stale' });

    const redis = makeMockRedis({}, [freshDlq, staleDlq]);
    const result = await flushStaleTaskState(
      redis as never,
      'builder:task:',
      'builder:task_queue',
      'builder:dlq',
      STALE_AGE_MS,
    );

    expect(result.dlqEntriesRemoved).toBe(1);
    // multi().del + multi().rpush with only the fresh entry
    const multi = redis.multi();
    expect(multi.del).toHaveBeenCalled();
  });

  it('returns zeros when nothing is stale', async () => {
    const taskData: Record<string, Record<string, string>> = {
      'builder:task:abc': { state: 'running', createdAt: freshTime },
    };

    const redis = makeMockRedis(taskData);
    const result = await flushStaleTaskState(
      redis as never,
      'builder:task:',
      'builder:task_queue',
      'builder:dlq',
      STALE_AGE_MS,
    );

    expect(result.tasksDeleted).toBe(0);
    expect(result.queueEntriesRemoved).toBe(0);
    expect(result.dlqEntriesRemoved).toBe(0);
  });
});
