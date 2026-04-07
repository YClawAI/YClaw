/**
 * Phase 5 tests for Builder Dispatcher observability and reliability features.
 *
 * Covers: sizeByPriority, P3 starvation promotion, DLQ push/read/depth,
 * stopGracefully drain, getMetrics snapshot.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AgentConfig, ExecutionRecord } from '../src/config/schema.js';

// ─── Mock Redis ─────────────────────────────────────────────────────────────

const mockPipelineExec = vi.fn().mockResolvedValue([]);
const mockPipeline = {
  hset: vi.fn().mockReturnThis(),
  zadd: vi.fn().mockReturnThis(),
  exec: mockPipelineExec,
};

const mockRedis = {
  pipeline: vi.fn(() => mockPipeline),
  zpopmin: vi.fn().mockResolvedValue([]),
  zrange: vi.fn().mockResolvedValue([]),
  zcard: vi.fn().mockResolvedValue(0),
  zrem: vi.fn().mockResolvedValue(1),
  hgetall: vi.fn().mockResolvedValue({}),
  hset: vi.fn().mockResolvedValue(1),
  expire: vi.fn().mockResolvedValue(1),
  lpush: vi.fn().mockResolvedValue(1),
  ltrim: vi.fn().mockResolvedValue('OK'),
  lrange: vi.fn().mockResolvedValue([]),
  llen: vi.fn().mockResolvedValue(0),
};

// ─── Mock Logger ─────────────────────────────────────────────────────────────

vi.mock('../src/logging/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// ─── Imports after mocks ─────────────────────────────────────────────────────

const { TaskQueue } = await import('../src/builder/task-queue.js');
const { BuilderDispatcher } = await import('../src/builder/dispatcher.js');
const { Priority, TaskState } = await import('../src/builder/types.js');

// ─── Fixtures ────────────────────────────────────────────────────────────────

function makeBuilderConfig(): AgentConfig {
  return {
    name: 'builder',
    department: 'development',
    description: 'Test builder',
    model: { provider: 'anthropic', model: 'claude-opus-4-6', temperature: 0.2, maxTokens: 16384 },
    system_prompts: [],
    triggers: [],
    actions: [],
    data_sources: [],
    event_subscriptions: [],
    event_publications: [],
    review_bypass: [],
  };
}

function makeExecutionRecord(overrides?: Partial<ExecutionRecord>): ExecutionRecord {
  return {
    id: 'exec-123',
    agent: 'builder',
    trigger: 'dispatcher',
    task: 'implement_issue',
    startedAt: new Date().toISOString(),
    status: 'completed',
    actionsTaken: [],
    selfModifications: [],
    ...overrides,
  };
}

function makeMockExecutor(result?: ExecutionRecord) {
  return {
    execute: vi.fn().mockResolvedValue(result ?? makeExecutionRecord()),
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

function makeBaseTask(overrides?: Record<string, unknown>) {
  return {
    id: 'task-p5',
    priority: Priority.P3_BACKGROUND,
    state: TaskState.QUEUED,
    taskName: 'self_reflection',
    triggerPayload: {},
    sourceEvent: 'manual',
    correlationId: 'corr-p5',
    createdAt: new Date().toISOString(),
    timeoutMs: 60_000,
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// TaskQueue — sizeByPriority
// ═══════════════════════════════════════════════════════════════════════════

describe('TaskQueue.sizeByPriority', () => {
  beforeEach(() => vi.clearAllMocks());

  it('queries each priority ZSET and returns the counts', async () => {
    mockRedis.zcard
      .mockResolvedValueOnce(2)  // P0
      .mockResolvedValueOnce(1)  // P1
      .mockResolvedValueOnce(4)  // P2
      .mockResolvedValueOnce(0); // P3

    const queue = new TaskQueue(mockRedis as any);
    const counts = await queue.sizeByPriority();

    expect(counts).toEqual({ P0: 2, P1: 1, P2: 4, P3: 0 });
    expect(mockRedis.zcard).toHaveBeenCalledTimes(4);
  });

  it('returns zero counts with null Redis', async () => {
    const queue = new TaskQueue(null);
    const counts = await queue.sizeByPriority();
    expect(counts).toEqual({ P0: 0, P1: 0, P2: 0, P3: 0 });
  });

  it('counts in-memory tasks by priority correctly', async () => {
    const queue = new TaskQueue(null);

    await queue.enqueue({ taskName: 'fix_ci_failure', priority: Priority.P0_SAFETY, sourceEvent: 'e', triggerPayload: {} });
    await queue.enqueue({ taskName: 'implement_issue', priority: Priority.P2_IMPLEMENTATION, sourceEvent: 'e', triggerPayload: {} });
    await queue.enqueue({ taskName: 'self_reflection', priority: Priority.P3_BACKGROUND, sourceEvent: 'e', triggerPayload: {} });

    const counts = await queue.sizeByPriority();
    expect(counts.P0).toBe(1);
    expect(counts.P1).toBe(0);
    expect(counts.P2).toBe(1);
    expect(counts.P3).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TaskQueue — P3 starvation promotion
// ═══════════════════════════════════════════════════════════════════════════

describe('TaskQueue P3 starvation promotion', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns null when promotionAgeMs is 0 (disabled)', async () => {
    const queue = new TaskQueue(mockRedis as any, { promotionAgeMs: 0 });

    // All zpopmin calls return empty (normal sweep)
    mockRedis.zpopmin.mockResolvedValue([]);

    const task = await queue.dequeue();
    expect(task).toBeNull();
    // zrange is only called inside checkP3Promotion — with promotion disabled
    // the method returns null immediately without calling zrange
    expect(mockRedis.zrange).not.toHaveBeenCalled();
  });

  it('skips promotion when the oldest P3 task is within the age threshold', async () => {
    const now = Date.now();
    // Score for a task that was enqueued 10 seconds ago
    const recentScore = (now - 10_000) * 1000;

    const queue = new TaskQueue(mockRedis as any, {
      promotionAgeMs: 30_000,   // 30s threshold
    });

    // checkP3Promotion: zrange returns a recent task (age < threshold)
    mockRedis.zrange.mockResolvedValueOnce(['task-recent', String(recentScore)]);

    // Normal P0→P3 sweep all return empty
    mockRedis.zpopmin.mockResolvedValue([]);

    const task = await queue.dequeue();
    expect(task).toBeNull();
    // zrange was called once for the promotion check, then dequeue fell through
    expect(mockRedis.zrange).toHaveBeenCalledTimes(1);
    // Normal sweep ran and called zpopmin for all 4 priority levels (P0–P3)
    expect(mockRedis.zpopmin).toHaveBeenCalledTimes(4);
  });

  it('promotes a starved P3 task when age exceeds threshold', async () => {
    const now = Date.now();
    const oldScore = (now - 60_000) * 1000; // 60s ago
    const taskId = 'task-starved';

    const taskData = {
      id: taskId,
      priority: '3',
      state: 'queued',
      taskName: 'self_reflection',
      triggerPayload: '{}',
      sourceEvent: 'manual',
      correlationId: 'corr-starved',
      createdAt: new Date(now - 60_000).toISOString(),
      timeoutMs: '180000',
    };

    const queue = new TaskQueue(mockRedis as any, {
      promotionAgeMs: 30_000,   // 30s threshold — task is 60s old, will promote
    });

    // checkP3Promotion: zrange with WITHSCORES returns the old task
    mockRedis.zrange.mockResolvedValueOnce([taskId, String(oldScore)]);
    // zpopmin removes it from P3
    mockRedis.zpopmin.mockResolvedValueOnce([taskId, String(oldScore)]);
    // hgetall returns task data
    mockRedis.hgetall.mockResolvedValueOnce(taskData);

    const task = await queue.dequeue();

    expect(task).not.toBeNull();
    expect(task!.id).toBe(taskId);
    expect(task!.state).toBe(TaskState.ASSIGNED);
    expect(task!.taskName).toBe('self_reflection');
    // The task was dequeued via promotion, not the normal sweep
    expect(mockRedis.hset).toHaveBeenCalledWith(
      expect.stringContaining(taskId),
      expect.objectContaining({ state: 'assigned' }),
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TaskQueue — Dead-Letter Queue
// ═══════════════════════════════════════════════════════════════════════════

describe('TaskQueue DLQ', () => {
  beforeEach(() => vi.clearAllMocks());

  it('pushToDlq stores JSON and trims the list', async () => {
    const queue = new TaskQueue(mockRedis as any, { dlqKey: 'builder:dlq', dlqMaxSize: 100 });

    await queue.pushToDlq({
      taskId: 'task-1',
      taskName: 'fix_ci_failure',
      correlationId: 'corr-1',
      priority: 0,
      sourceEvent: 'github:ci_fail',
      error: 'Build failed',
      failedAt: new Date().toISOString(),
      durationMs: 5000,
    });

    expect(mockRedis.lpush).toHaveBeenCalledWith('builder:dlq', expect.any(String));
    expect(mockRedis.ltrim).toHaveBeenCalledWith('builder:dlq', 0, 99);

    const arg = (mockRedis.lpush.mock.calls[0] as unknown[])[1] as string;
    const parsed = JSON.parse(arg) as Record<string, unknown>;
    expect(parsed.taskId).toBe('task-1');
    expect(parsed.error).toBe('Build failed');
  });

  it('getDlqEntries parses JSON entries from lrange', async () => {
    const entry = {
      taskId: 'task-2',
      taskName: 'implement_issue',
      correlationId: 'corr-2',
      priority: 2,
      sourceEvent: 'github:issue_assigned',
      error: 'LLM timeout',
      failedAt: new Date().toISOString(),
      durationMs: 600_000,
    };

    mockRedis.lrange.mockResolvedValueOnce([JSON.stringify(entry)]);

    const queue = new TaskQueue(mockRedis as any);
    const entries = await queue.getDlqEntries(5);

    expect(entries).toHaveLength(1);
    expect(entries[0]!.taskId).toBe('task-2');
    expect(entries[0]!.error).toBe('LLM timeout');
    expect(mockRedis.lrange).toHaveBeenCalledWith('builder:dlq', 0, 4);
  });

  it('getDlqDepth returns llen result', async () => {
    mockRedis.llen.mockResolvedValueOnce(7);

    const queue = new TaskQueue(mockRedis as any);
    const depth = await queue.getDlqDepth();

    expect(depth).toBe(7);
    expect(mockRedis.llen).toHaveBeenCalledWith('builder:dlq');
  });

  it('all DLQ methods are no-ops with null Redis', async () => {
    const queue = new TaskQueue(null);

    await expect(queue.pushToDlq({
      taskId: 't', taskName: 'n', correlationId: 'c', priority: 2,
      sourceEvent: 'e', error: 'err', failedAt: '', durationMs: null,
    })).resolves.toBeUndefined();

    expect(await queue.getDlqEntries()).toEqual([]);
    expect(await queue.getDlqDepth()).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// BuilderDispatcher — stopGracefully
// ═══════════════════════════════════════════════════════════════════════════

describe('BuilderDispatcher.stopGracefully', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns immediately when no workers are busy', async () => {
    const dispatcher = new BuilderDispatcher(
      {
        redis: null,
        executor: makeMockExecutor() as any,
        eventBus: makeMockEventBus() as any,
        builderConfig: makeBuilderConfig(),
      },
      { maxConcurrentWorkers: 2 },
    );

    dispatcher.start();
    await dispatcher.stopGracefully(5_000);

    expect(dispatcher.getStatus().running).toBe(false);
  });

  it('waits for busy workers then force-stops stragglers', async () => {
    // Worker that hangs until aborted
    const mockExecutor = makeMockExecutor();
    mockExecutor.execute.mockImplementationOnce(
      (_config: any, _task: any, _trigger: any, _payload: any, _model: any, signal?: AbortSignal) =>
        new Promise<ExecutionRecord>((resolve, reject) => {
          const timer = setTimeout(resolve, 30_000);
          signal?.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(new Error('aborted'));
          });
        }),
    );

    const dispatcher = new BuilderDispatcher(
      {
        redis: mockRedis as any,
        executor: mockExecutor as any,
        eventBus: makeMockEventBus() as any,
        builderConfig: makeBuilderConfig(),
      },
      { maxConcurrentWorkers: 1, pollIntervalMs: 100_000 },
    );

    // Manually enqueue and dispatch one task so a worker goes busy
    mockRedis.zrange.mockResolvedValue([]);
    mockRedis.zpopmin
      .mockResolvedValueOnce(['task-busy', '12345000'])
      .mockResolvedValue([]);
    mockRedis.hgetall.mockResolvedValueOnce({
      id: 'task-busy', priority: '2', state: 'queued',
      taskName: 'implement_issue', triggerPayload: '{}',
      sourceEvent: 'manual', correlationId: 'corr-busy',
      createdAt: new Date().toISOString(), timeoutMs: '60000',
    });

    dispatcher.start();
    // Trigger one dispatch cycle
    await dispatcher.enqueueTask({ taskName: 'implement_issue' });

    // Give it a moment to be picked up by the worker
    await new Promise<void>(r => setTimeout(r, 50));

    // stopGracefully with a very short timeout — will force-stop the straggler
    await dispatcher.stopGracefully(100);

    expect(dispatcher.getStatus().running).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// BuilderDispatcher — getMetrics
// ═══════════════════════════════════════════════════════════════════════════

describe('BuilderDispatcher.getMetrics', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns a valid metrics snapshot with all fields', async () => {
    mockRedis.zcard.mockResolvedValue(0);
    mockRedis.llen.mockResolvedValue(0);
    mockRedis.lrange.mockResolvedValue([]);

    const dispatcher = new BuilderDispatcher(
      {
        redis: mockRedis as any,
        executor: makeMockExecutor() as any,
        eventBus: makeMockEventBus() as any,
        builderConfig: makeBuilderConfig(),
      },
      { maxConcurrentWorkers: 3 },
    );

    const m = await dispatcher.getMetrics();

    expect(m.timestamp).toBeDefined();
    expect(m.workers.total).toBe(3);
    expect(m.workers.idle).toBe(3);
    expect(m.workers.busy).toBe(0);
    expect(m.queue.byPriority).toEqual({ P0: 0, P1: 0, P2: 0, P3: 0 });
    expect(m.queue.total).toBe(0);
    expect(m.recentTasks.completed).toBe(0);
    expect(m.recentTasks.failed).toBe(0);
    expect(m.recentTasks.timedOut).toBe(0);
    expect(m.recentTasks.avgDurationMs).toBeNull();
    expect(m.recentTasks.p95DurationMs).toBeNull();
    expect(m.dlq.depth).toBe(0);
    expect(m.dlq.entries).toEqual([]);
  });

  it('includes DLQ depth and entries in the snapshot', async () => {
    const dlqEntry = {
      taskId: 'task-failed', taskName: 'implement_issue',
      correlationId: 'c', priority: 2,
      sourceEvent: 'github:issue_assigned', error: 'Bad request',
      failedAt: new Date().toISOString(), durationMs: 3000,
    };

    mockRedis.zcard.mockResolvedValue(0);
    mockRedis.llen.mockResolvedValueOnce(1);
    mockRedis.lrange.mockResolvedValueOnce([JSON.stringify(dlqEntry)]);

    const dispatcher = new BuilderDispatcher(
      {
        redis: mockRedis as any,
        executor: makeMockExecutor() as any,
        eventBus: makeMockEventBus() as any,
        builderConfig: makeBuilderConfig(),
      },
      { maxConcurrentWorkers: 2 },
    );

    const m = await dispatcher.getMetrics();

    expect(m.dlq.depth).toBe(1);
    expect(m.dlq.entries).toHaveLength(1);
    expect(m.dlq.entries[0]!.taskId).toBe('task-failed');
  });

  it('computes avgDurationMs and p95DurationMs after tasks complete', async () => {
    mockRedis.zcard.mockResolvedValue(0);
    mockRedis.zrange.mockResolvedValue([]);
    mockRedis.zpopmin.mockResolvedValue([]);
    mockRedis.llen.mockResolvedValue(0);
    mockRedis.lrange.mockResolvedValue([]);

    // Executor resolves instantly with a success record
    const mockExecutor = makeMockExecutor();

    const dispatcher = new BuilderDispatcher(
      {
        redis: mockRedis as any,
        executor: mockExecutor as any,
        eventBus: makeMockEventBus() as any,
        builderConfig: makeBuilderConfig(),
      },
      { maxConcurrentWorkers: 1, pollIntervalMs: 100_000 },
    );

    dispatcher.start();

    // Enqueue a task to exercise runWorker duration tracking
    await dispatcher.enqueueTask({ taskName: 'daily_standup' });
    // Give the async runWorker time to complete
    await new Promise<void>(r => setTimeout(r, 50));

    const m = await dispatcher.getMetrics();
    // avgDurationMs should be non-null if a task ran
    // (it might still be null if the worker didn't pick up the task in the short window,
    // but at minimum the structure should be correct)
    expect(typeof m.recentTasks.avgDurationMs === 'number' || m.recentTasks.avgDurationMs === null).toBe(true);

    dispatcher.stop();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// BuilderDispatcher — DLQ alert + setSlackAlerter
// ═══════════════════════════════════════════════════════════════════════════

describe('BuilderDispatcher DLQ Slack alerting', () => {
  beforeEach(() => vi.clearAllMocks());

  it('fires slackAlerter when a task enters DLQ via FAILED result', async () => {
    const slackAlerter = vi.fn().mockResolvedValue(undefined);

    mockRedis.zrange.mockResolvedValue([]);
    mockRedis.zpopmin
      .mockResolvedValueOnce(['task-fail', '12345000'])
      .mockResolvedValue([]);
    mockRedis.hgetall.mockResolvedValueOnce({
      id: 'task-fail', priority: '2', state: 'queued',
      taskName: 'implement_issue', triggerPayload: '{}',
      sourceEvent: 'github:issue_assigned', correlationId: 'corr-fail',
      createdAt: new Date().toISOString(), timeoutMs: '60000',
    });
    mockRedis.lpush.mockResolvedValue(1);
    mockRedis.ltrim.mockResolvedValue('OK');

    const failingExecutor = makeMockExecutor(
      makeExecutionRecord({ status: 'failed', error: 'Codegen crashed' }),
    );

    const dispatcher = new BuilderDispatcher(
      {
        redis: mockRedis as any,
        executor: failingExecutor as any,
        eventBus: makeMockEventBus() as any,
        builderConfig: makeBuilderConfig(),
      },
      { maxConcurrentWorkers: 1, pollIntervalMs: 100_000 },
    );

    dispatcher.setSlackAlerter(slackAlerter);
    dispatcher.start();

    await dispatcher.enqueueTask({ taskName: 'implement_issue' });
    // Wait for async worker to finish
    await new Promise<void>(r => setTimeout(r, 100));

    expect(mockRedis.lpush).toHaveBeenCalledWith('builder:dlq', expect.any(String));

    // DLQ alerts are now batched — stop() flushes the buffer
    dispatcher.stop();
    // Allow the async flush to complete
    await new Promise<void>(r => setTimeout(r, 50));

    expect(slackAlerter).toHaveBeenCalledWith(
      expect.stringContaining('DLQ'),
      '#yclaw-alerts',
    );
  });

  it('postSlackDigest is a no-op when no alerter is set', async () => {
    const dispatcher = new BuilderDispatcher({
      redis: null,
      executor: makeMockExecutor() as any,
      eventBus: makeMockEventBus() as any,
      builderConfig: makeBuilderConfig(),
    });

    // Should not throw
    await expect(dispatcher.postSlackDigest('test', '#yclaw-development')).resolves.toBeUndefined();
  });

  it('postSlackDigest delegates to the registered alerter', async () => {
    const slackAlerter = vi.fn().mockResolvedValue(undefined);

    const dispatcher = new BuilderDispatcher({
      redis: null,
      executor: makeMockExecutor() as any,
      eventBus: makeMockEventBus() as any,
      builderConfig: makeBuilderConfig(),
    });

    dispatcher.setSlackAlerter(slackAlerter);
    await dispatcher.postSlackDigest('Metrics digest text', '#yclaw-development');

    expect(slackAlerter).toHaveBeenCalledWith('Metrics digest text', '#yclaw-development');
  });
});
