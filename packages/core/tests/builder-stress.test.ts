/**
 * Adversarial / stress tests for Builder Dispatcher-Worker architecture.
 *
 * These tests intentionally probe edge cases and concurrency hazards.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { AgentConfig } from '../src/config/schema.js';

vi.mock('../src/logging/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock('node:crypto', async () => {
  const actual = await vi.importActual<typeof import('node:crypto')>('node:crypto');
  return {
    ...actual,
    randomUUID: vi.fn(actual.randomUUID),
  };
});

const { TaskQueue } = await import('../src/builder/task-queue.js');
const { BuilderDispatcher } = await import('../src/builder/dispatcher.js');
const { Priority, TaskState } = await import('../src/builder/types.js');
const { randomUUID } = await import('node:crypto');

function makeBuilderConfig(): AgentConfig {
  return {
    name: 'builder',
    department: 'development',
    description: 'Test builder',
    model: { provider: 'anthropic', model: 'claude-opus-4-6', temperature: 0.2, maxTokens: 16384 },
    system_prompts: [],
    triggers: [
      { type: 'event', event: 'github:issue_assigned', task: 'implement_issue' },
      { type: 'event', event: 'github:ci_fail', task: 'fix_ci_failure' },
    ],
    actions: ['codegen:execute', 'github:create_pr'],
    data_sources: [],
    event_subscriptions: ['github:issue_assigned', 'github:ci_fail'],
    event_publications: ['builder:pr_ready'],
    review_bypass: [],
  };
}

function makeMockExecutor(delayMs = 0) {
  return {
    execute: vi.fn().mockImplementation(
      () => new Promise(resolve => setTimeout(() => resolve({
        id: 'exec-1',
        agent: 'builder',
        trigger: 'dispatcher',
        task: 'implement_issue',
        startedAt: new Date().toISOString(),
        status: 'completed',
        actionsTaken: [],
        selfModifications: [],
      }), delayMs)),
    ),
    setHumanizationGate: vi.fn(),
  };
}

function makeMockEventBus() {
  return {
    subscribe: vi.fn(),
    publish: vi.fn().mockResolvedValue(undefined),
    publishCoordEvent: vi.fn().mockResolvedValue(undefined),
    unsubscribe: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

class InMemoryRedis {
  private zsets = new Map<string, Map<string, number>>();
  private hashes = new Map<string, Record<string, string>>();

  pipeline() {
    return {
      hset: (key: string, data: Record<string, string>) => {
        this.hset(key, data);
        return this;
      },
      zadd: (key: string, score: string, member: string) => {
        this.zadd(key, score, member);
        return this;
      },
      exec: async () => [],
    };
  }

  zadd(key: string, score: string, member: string) {
    const zset = this.zsets.get(key) ?? new Map<string, number>();
    zset.set(member, Number(score));
    this.zsets.set(key, zset);
    return 1;
  }

  zpopmin(key: string) {
    const zset = this.zsets.get(key);
    if (!zset || zset.size === 0) return Promise.resolve([] as any[]);

    const sorted = [...zset.entries()].sort((a, b) => {
      if (a[1] !== b[1]) return a[1] - b[1];
      return a[0].localeCompare(b[0]); // tie-break by lex order (Redis behavior)
    });

    const [member, score] = sorted[0]!;
    zset.delete(member);
    return Promise.resolve([member, String(score)]);
  }

  zrange(key: string, start: number, stop: number) {
    const zset = this.zsets.get(key);
    if (!zset || zset.size === 0) return Promise.resolve([] as string[]);

    const sorted = [...zset.entries()].sort((a, b) => {
      if (a[1] !== b[1]) return a[1] - b[1];
      return a[0].localeCompare(b[0]);
    }).map(([member]) => member);

    const end = stop < 0 ? sorted.length : stop + 1;
    return Promise.resolve(sorted.slice(start, end));
  }

  zcard(key: string) {
    const zset = this.zsets.get(key);
    return Promise.resolve(zset ? zset.size : 0);
  }

  zrem(key: string, member: string) {
    const zset = this.zsets.get(key);
    if (!zset) return Promise.resolve(0);
    const removed = zset.delete(member) ? 1 : 0;
    return Promise.resolve(removed);
  }

  hgetall(key: string) {
    return Promise.resolve(this.hashes.get(key) ?? {});
  }

  hset(key: string, data: Record<string, string>) {
    const existing = this.hashes.get(key) ?? {};
    this.hashes.set(key, { ...existing, ...data });
    return Promise.resolve(1);
  }

  expire() {
    return Promise.resolve(1);
  }
}

function makeTask(id: string) {
  return {
    id,
    priority: Priority.P2_IMPLEMENTATION,
    state: TaskState.ASSIGNED as const,
    taskName: 'implement_issue',
    triggerPayload: {},
    sourceEvent: 'github:issue_assigned',
    correlationId: `corr-${id}`,
    createdAt: new Date().toISOString(),
    timeoutMs: 5000,
  };
}

function makeDeferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(res => { resolve = res; });
  return { promise, resolve };
}

// ═══════════════════════════════════════════════════════════════════════════
// Adversarial tests
// ═══════════════════════════════════════════════════════════════════════════

describe('Builder stress tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('mutex prevents double-dispatch race from failing tasks', async () => {
    const executor = makeMockExecutor(50);
    const dispatcher = new BuilderDispatcher(
      {
        redis: null,
        executor: executor as any,
        eventBus: makeMockEventBus() as any,
        builderConfig: makeBuilderConfig(),
      },
      { maxConcurrentWorkers: 1, pollIntervalMs: 100000 },
    );

    const deferred = makeDeferred();
    const tasks = [makeTask('task-1'), makeTask('task-2')];

    const fakeQueue = {
      dequeue: vi.fn(async () => {
        await deferred.promise;
        return tasks.shift() ?? null;
      }),
      updateTask: vi.fn(async () => {}),
      recoverOrphaned: vi.fn(async () => 0),
    };

    (dispatcher as any).queue = fakeQueue;
    dispatcher.start();

    const dispatchNext = (dispatcher as any).dispatchNext.bind(dispatcher);
    const p1 = dispatchNext();
    const p2 = dispatchNext();

    deferred.resolve();
    await Promise.allSettled([p1, p2]);
    await new Promise(resolve => setTimeout(resolve, 120));

    // With the mutex fix, task-2 should NOT be marked as failed.
    // The mutex serializes dispatch calls so only one runs at a time.
    const failCalls = fakeQueue.updateTask.mock.calls.filter(
      (call: any[]) => call[1]?.state === TaskState.FAILED
    );
    expect(failCalls.length).toBe(0);

    dispatcher.stop();
  });

  it('drops a queued task if the Redis hash is missing after ZPOPMIN', async () => {
    const redis = new InMemoryRedis();
    const queue = new TaskQueue(redis as any);

    // Per-priority ZSET keys (Issue #6 fix)
    await redis.zadd('builder:task_queue:P2', '1', 'task-missing');

    const task = await queue.dequeue();
    expect(task).toBeNull();

    const remaining = await redis.zcard('builder:task_queue:P2');
    expect(remaining).toBe(0); // task lost because hash was missing
  });

  it('can violate FIFO within same priority when scores collide', async () => {
    const redis = new InMemoryRedis();
    const queue = new TaskQueue(redis as any);

    vi.spyOn(Date, 'now').mockReturnValue(1710000000000);

    (randomUUID as unknown as { mockImplementationOnce: (fn: () => string) => void })
      .mockImplementationOnce(() => 'b-task')
      .mockImplementationOnce(() => 'a-task');

    const first = await queue.enqueue({
      taskName: 'implement_issue',
      priority: Priority.P2_IMPLEMENTATION,
      sourceEvent: 'manual',
      triggerPayload: {},
      correlationId: 'corr-1',
    });

    const second = await queue.enqueue({
      taskName: 'implement_issue',
      priority: Priority.P2_IMPLEMENTATION,
      sourceEvent: 'manual',
      triggerPayload: {},
      correlationId: 'corr-2',
    });

    const dequeued = await queue.dequeue();
    // With monotonic counter fix, first enqueued should dequeue first (FIFO preserved)
    expect(dequeued?.id).toBe(first.id);
  });

  it('executes tasks even when Redis is null (in-memory fallback queue)', async () => {
    const executor = makeMockExecutor();
    const dispatcher = new BuilderDispatcher(
      {
        redis: null,
        executor: executor as any,
        eventBus: makeMockEventBus() as any,
        builderConfig: makeBuilderConfig(),
      },
      { maxConcurrentWorkers: 1, pollIntervalMs: 50 },
    );

    dispatcher.start();

    await dispatcher.enqueueTask({
      taskName: 'implement_issue',
      triggerPayload: { issue: 123 },
    });

    await new Promise(resolve => setTimeout(resolve, 200));

    // With in-memory fallback, tasks SHOULD be executed even without Redis
    expect(executor.execute).toHaveBeenCalled();

    dispatcher.stop();
  });
});
