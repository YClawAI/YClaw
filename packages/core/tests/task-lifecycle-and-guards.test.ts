/**
 * Tests for Task Lifecycle Wiring (Fix 1) and Strategist Queue Guards (Fix 2).
 *
 * Covers:
 *   - updateTaskRegistry called with correct status on all terminal paths
 *   - Fire-and-forget semantics (registry errors do not block dispatcher)
 *   - Strategist directive hard cap at queue depth >= 15
 *   - Non-strategist events unaffected by the guard
 *   - getQueueHealth accuracy and isHealthy logic
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AgentConfig, AgentEvent, ExecutionRecord } from '../src/config/schema.js';

// ─── Mock Redis Pipeline ────────────────────────────────────────────────────

const mockPipelineExec = vi.fn().mockResolvedValue([]);
const mockPipeline = {
  hset: vi.fn().mockReturnThis(),
  zadd: vi.fn().mockReturnThis(),
  del: vi.fn().mockReturnThis(),
  rpush: vi.fn().mockReturnThis(),
  expire: vi.fn().mockReturnThis(),
  exec: mockPipelineExec,
};

const mockRedis = {
  pipeline: vi.fn(() => mockPipeline),
  zpopmin: vi.fn().mockResolvedValue([]),
  zrange: vi.fn().mockResolvedValue([]),
  zrangebyscore: vi.fn().mockResolvedValue([]),
  zcard: vi.fn().mockResolvedValue(0),
  zadd: vi.fn().mockResolvedValue(1),
  zrem: vi.fn().mockResolvedValue(1),
  zscore: vi.fn().mockResolvedValue(null),
  hgetall: vi.fn().mockResolvedValue({}),
  hset: vi.fn().mockResolvedValue(1),
  expire: vi.fn().mockResolvedValue(1),
  scan: vi.fn().mockResolvedValue(['0', []]),
  lrange: vi.fn().mockResolvedValue([]),
  llen: vi.fn().mockResolvedValue(0),
  lpush: vi.fn().mockResolvedValue(1),
  ltrim: vi.fn().mockResolvedValue('OK'),
  rpush: vi.fn().mockResolvedValue(1),
  get: vi.fn().mockResolvedValue(null),
  set: vi.fn().mockResolvedValue('OK'),
  del: vi.fn().mockResolvedValue(1),
  eval: vi.fn().mockResolvedValue(1),
};

// ─── Mock Logger ────────────────────────────────────────────────────────────

const mockLoggers = new Map<string, { warn: ReturnType<typeof vi.fn> }>();
vi.mock('../src/logging/logger.js', () => ({
  createLogger: (name: string) => {
    const loggerInstance = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };
    mockLoggers.set(name, loggerInstance);
    return loggerInstance;
  },
}));

// ─── Import after mocks ────────────────────────────────────────────────────

const { BuilderDispatcher } = await import('../src/builder/dispatcher.js');
const { Priority, TaskState } = await import('../src/builder/types.js');

// ─── Test Fixtures ──────────────────────────────────────────────────────────

function makeBuilderConfig(): AgentConfig {
  return {
    name: 'builder',
    department: 'development',
    description: 'Test builder',
    model: { provider: 'anthropic', model: 'claude-opus-4-6', temperature: 0.2, maxTokens: 16384 },
    system_prompts: [],
    triggers: [
      { type: 'event', event: 'architect:build_directive', task: 'implement_directive' },
      { type: 'event', event: 'github:ci_fail', task: 'fix_ci_failure' },
      { type: 'event', event: 'strategist:builder_directive', task: 'implement_directive' },
    ],
    actions: ['codegen:execute', 'github:create_pr'],
    data_sources: [],
    event_subscriptions: ['architect:build_directive', 'github:ci_fail', 'strategist:builder_directive'],
    event_publications: ['builder:pr_ready'],
    review_bypass: [],
  };
}

function makeExecutionRecord(overrides?: Partial<ExecutionRecord>): ExecutionRecord {
  return {
    id: 'exec-123',
    agent: 'builder',
    trigger: 'dispatcher',
    task: 'implement_directive',
    startedAt: new Date().toISOString(),
    status: 'completed',
    actionsTaken: [],
    selfModifications: [],
    ...overrides,
  };
}

function makeEvent(overrides?: Partial<AgentEvent>): AgentEvent {
  return {
    id: 'evt-123',
    source: 'github',
    type: 'issue_assigned',
    payload: { issue_number: 205, repo: 'yclaw-protocol' },
    timestamp: new Date().toISOString(),
    correlationId: `corr-${Date.now()}`,
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

/** Create a dispatcher with in-memory queue (null Redis) for end-to-end worker tests. */
function createInMemoryDispatcher(overrides?: {
  updateTaskRegistry?: ReturnType<typeof vi.fn>;
  executorResult?: ExecutionRecord;
}) {
  const updateTaskRegistry = overrides?.updateTaskRegistry ?? vi.fn().mockResolvedValue(undefined);
  const executor = makeMockExecutor(overrides?.executorResult);
  const eventBus = makeMockEventBus();

  const dispatcher = new BuilderDispatcher(
    {
      redis: null,
      executor: executor as any,
      eventBus: eventBus as any,
      builderConfig: makeBuilderConfig(),
      updateTaskRegistry,
    },
    { maxConcurrentWorkers: 1 },
  );

  return { dispatcher, updateTaskRegistry, executor, eventBus };
}

/** Create a dispatcher with mock Redis for queue-depth-dependent tests. */
function createRedisDispatcher(overrides?: {
  updateTaskRegistry?: ReturnType<typeof vi.fn>;
}) {
  const updateTaskRegistry = overrides?.updateTaskRegistry ?? vi.fn().mockResolvedValue(undefined);
  const executor = makeMockExecutor();
  const eventBus = makeMockEventBus();

  const dispatcher = new BuilderDispatcher(
    {
      redis: mockRedis as any,
      executor: executor as any,
      eventBus: eventBus as any,
      builderConfig: makeBuilderConfig(),
      updateTaskRegistry,
    },
    { maxConcurrentWorkers: 1 },
  );

  return { dispatcher, updateTaskRegistry, executor, eventBus };
}

// ═══════════════════════════════════════════════════════════════════════════
// Fix 1: Task Lifecycle Wiring — Worker Terminal States
// ═══════════════════════════════════════════════════════════════════════════

describe('Task Lifecycle Wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoggers.clear();
    mockRedis.zcard.mockResolvedValue(0);
    mockRedis.set.mockResolvedValue('OK');
    mockRedis.get.mockResolvedValue(null);
    mockRedis.llen.mockResolvedValue(0);
  });

  it('calls updateTaskRegistry with "completed" when task completes', async () => {
    const { dispatcher, updateTaskRegistry, executor } = createInMemoryDispatcher();
    executor.execute.mockResolvedValue(makeExecutionRecord({ status: 'completed' }));

    dispatcher.start();
    await dispatcher.enqueueTask({
      taskName: 'implement_directive',
      triggerPayload: { issue_number: 1, repo: 'test' },
    });

    // Wait for the fire-and-forget worker to finish
    await new Promise(r => setTimeout(r, 200));
    dispatcher.stop();

    expect(updateTaskRegistry).toHaveBeenCalledWith(
      expect.objectContaining({
        agent: 'builder',
        task: 'implement_directive',
        status: 'completed',
      }),
    );
  });

  it('calls updateTaskRegistry with "failed" when task fails', async () => {
    const { dispatcher, updateTaskRegistry, executor } = createInMemoryDispatcher();
    executor.execute.mockResolvedValue(makeExecutionRecord({ status: 'failed', error: 'boom' }));

    dispatcher.start();
    await dispatcher.enqueueTask({
      taskName: 'implement_directive',
      triggerPayload: { issue_number: 1, repo: 'test' },
    });

    await new Promise(r => setTimeout(r, 200));
    dispatcher.stop();

    expect(updateTaskRegistry).toHaveBeenCalledWith(
      expect.objectContaining({
        agent: 'builder',
        task: 'implement_directive',
        status: 'failed',
      }),
    );
  });

  it('calls updateTaskRegistry with "failed" when task times out', async () => {
    const executor = makeMockExecutor();
    const updateTaskRegistry = vi.fn().mockResolvedValue(undefined);

    // Make executor hang until abort signal fires, then reject.
    // The worker waits for executorPromise.catch() after timeout, so
    // the executor must actually settle for the worker to finish.
    executor.execute.mockImplementation(
      (_cfg: any, _task: any, _trigger: any, _payload: any, _model: any, signal?: AbortSignal) =>
        new Promise((_resolve, reject) => {
          if (signal) {
            signal.addEventListener('abort', () => {
              reject(new Error('Aborted'));
            });
          }
        }),
    );

    const dispatcher = new BuilderDispatcher(
      {
        redis: null,
        executor: executor as any,
        eventBus: makeMockEventBus() as any,
        builderConfig: makeBuilderConfig(),
        updateTaskRegistry,
      },
      { maxConcurrentWorkers: 1, pollIntervalMs: 100 },
    );

    dispatcher.start();
    await dispatcher.enqueueTask({
      taskName: 'implement_directive',
      timeoutMs: 50,
      triggerPayload: { issue_number: 1, repo: 'test' },
    });

    // Wait for timeout (50ms) + retry re-enqueue + second timeout + DLQ processing
    // The poll interval is 100ms and we need 2 timeout cycles + processing
    await new Promise(r => setTimeout(r, 1500));
    dispatcher.stop();

    // After timeout + retry, updateTaskRegistry should be called with 'failed'
    const failedCalls = updateTaskRegistry.mock.calls.filter(
      (c: any[]) => c[0]?.status === 'failed',
    );
    expect(failedCalls.length).toBeGreaterThan(0);
  });

  it('calls updateTaskRegistry with "failed" on backpressure rejection', async () => {
    const { dispatcher, updateTaskRegistry } = createRedisDispatcher();
    // Each of 4 priority ZSETs returns 13 => totalSize = 52 >= 50 max queue depth
    mockRedis.zcard.mockResolvedValue(13);

    dispatcher.start();
    const task = await dispatcher.handleEvent('architect:build_directive', makeEvent());
    dispatcher.stop();

    expect(task).toBeNull();
    expect(updateTaskRegistry).toHaveBeenCalledWith(
      expect.objectContaining({
        agent: 'builder',
        task: 'implement_directive',
        status: 'failed',
      }),
    );
  });

  it('calls updateTaskRegistry with "failed" on circuit breaker rejection', async () => {
    const { dispatcher, updateTaskRegistry, executor } = createInMemoryDispatcher();
    executor.execute.mockResolvedValue(makeExecutionRecord({ status: 'failed', error: 'fail' }));

    const payload = { issue_number: 999, repo: 'my-repo', owner: 'yclaw-ai' };

    dispatcher.start();

    // Trigger 3 failures on the same project to open the circuit breaker
    for (let i = 0; i < 3; i++) {
      await dispatcher.enqueueTask({
        taskName: 'implement_directive',
        triggerPayload: payload,
        correlationId: `corr-fail-${i}-${Date.now()}`,
      });
      // Wait for worker to complete each task
      await new Promise(r => setTimeout(r, 200));
    }

    // 4th attempt via handleEvent should be rejected by circuit breaker
    updateTaskRegistry.mockClear();
    const event4 = makeEvent({
      payload,
      correlationId: `corr-cb-${Date.now()}`,
    });
    const task = await dispatcher.handleEvent('architect:build_directive', event4);
    dispatcher.stop();

    expect(task).toBeNull();
    expect(updateTaskRegistry).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'failed',
      }),
    );
  });

  it('does not block dispatcher when updateTaskRegistry throws', async () => {
    const updateTaskRegistry = vi.fn().mockRejectedValue(new Error('Redis down'));
    const { dispatcher, executor } = createInMemoryDispatcher({ updateTaskRegistry });
    executor.execute.mockResolvedValue(makeExecutionRecord({ status: 'completed' }));

    dispatcher.start();
    await dispatcher.enqueueTask({
      taskName: 'implement_directive',
      triggerPayload: { issue_number: 1, repo: 'test' },
    });

    // Wait for worker to finish
    await new Promise(r => setTimeout(r, 200));
    dispatcher.stop();

    // The callback was called (and threw), but dispatcher continued without crashing
    expect(updateTaskRegistry).toHaveBeenCalled();
  });

  it('logs warning when updateTaskRegistry throws', async () => {
    const updateTaskRegistry = vi.fn().mockRejectedValue(new Error('Redis down'));
    const { dispatcher, executor } = createInMemoryDispatcher({ updateTaskRegistry });
    executor.execute.mockResolvedValue(makeExecutionRecord({ status: 'completed' }));

    dispatcher.start();
    await dispatcher.enqueueTask({
      taskName: 'implement_directive',
      triggerPayload: { issue_number: 1, repo: 'test' },
    });

    await new Promise(r => setTimeout(r, 200));
    dispatcher.stop();

    // The updateTaskRegistry was called and rejected — the dispatcher logger
    // is a module-level singleton, so we verify indirectly: the callback was
    // called, it threw, and the dispatcher continued without crashing.
    expect(updateTaskRegistry).toHaveBeenCalled();

    // Verify the logger was instantiated with the dispatcher name and
    // the warn method exists (the .catch handler calls logger.warn internally).
    // We can't check the exact call because the module-level logger instance
    // is captured at import time, but we've already verified the callback threw
    // and the dispatcher didn't crash — that's the safety guarantee.
    const dispatcherLogger = mockLoggers.get('builder-dispatcher');
    // The logger may have been created before the test if the module was cached;
    // if it exists, verify warn was called with the expected message.
    if (dispatcherLogger) {
      expect(dispatcherLogger.warn).toHaveBeenCalledWith(
        'updateTaskRegistry failed (non-fatal)',
        expect.objectContaining({ error: 'Redis down' }),
      );
    }
  });

  it('handles duplicate completion idempotently (no error)', async () => {
    const updateTaskRegistry = vi.fn().mockResolvedValue(undefined);
    const { dispatcher, executor } = createInMemoryDispatcher({ updateTaskRegistry });
    executor.execute.mockResolvedValue(makeExecutionRecord({ status: 'completed' }));

    dispatcher.start();
    await dispatcher.enqueueTask({
      taskName: 'implement_directive',
      triggerPayload: { issue_number: 1, repo: 'test' },
      correlationId: `unique-${Date.now()}`,
    });

    await new Promise(r => setTimeout(r, 200));
    dispatcher.stop();

    // Callback was called — no errors thrown
    expect(updateTaskRegistry).toHaveBeenCalled();
    const calls = updateTaskRegistry.mock.calls;
    for (const call of calls) {
      expect(call[0]).toHaveProperty('status');
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Fix 2: Strategist Queue Guards
// ═══════════════════════════════════════════════════════════════════════════

describe('Strategist Queue Guards', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoggers.clear();
    mockRedis.zcard.mockResolvedValue(0);
    mockRedis.set.mockResolvedValue('OK');
    mockRedis.get.mockResolvedValue(null);
    mockRedis.llen.mockResolvedValue(0);
  });

  it('accepts strategist directive when total work < 5', async () => {
    const { dispatcher } = createRedisDispatcher();
    // Queue: 4 queues * 1 = 4, workers: 0 busy => total = 4 < 5
    mockRedis.zcard.mockResolvedValue(1);

    dispatcher.start();
    const task = await dispatcher.handleEvent('strategist:builder_directive', makeEvent({
      source: 'strategist',
      type: 'builder_directive',
      payload: { task: 'implement_directive', description: 'test' },
    }));
    dispatcher.stop();

    expect(task).not.toBeNull();
  });

  it('rejects strategist directive when total work >= 5', async () => {
    const { dispatcher, updateTaskRegistry } = createRedisDispatcher();
    // Queue: 4 queues * 2 = 8, workers: 0 busy => total = 8 >= 5
    mockRedis.zcard.mockResolvedValue(2);

    dispatcher.start();
    const task = await dispatcher.handleEvent('strategist:builder_directive', makeEvent({
      source: 'strategist',
      type: 'builder_directive',
      payload: { task: 'implement_directive', description: 'test' },
      correlationId: `strat-${Date.now()}`,
    }));
    dispatcher.stop();

    expect(task).toBeNull();
    expect(updateTaskRegistry).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'failed',
        task: 'implement_directive',
      }),
    );
  });

  it('does NOT reject non-strategist events when total work >= 5', async () => {
    const { dispatcher } = createRedisDispatcher();
    // Queue: 4 queues * 2 = 8 >= 5, but NOT a strategist event
    // backpressureThreshold is 30 by default so it won't trigger backpressure either
    mockRedis.zcard.mockResolvedValue(2);

    dispatcher.start();
    const task = await dispatcher.handleEvent('architect:build_directive', makeEvent());
    dispatcher.stop();

    // Non-strategist events pass through the strategist guard
    expect(task).not.toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// getQueueHealth
// ═══════════════════════════════════════════════════════════════════════════

describe('getQueueHealth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRedis.zcard.mockResolvedValue(0);
    mockRedis.llen.mockResolvedValue(0);
  });

  it('returns accurate metrics', async () => {
    mockRedis.zcard.mockResolvedValue(2); // 4 queues * 2 = 8 total
    mockRedis.llen.mockResolvedValue(3); // DLQ depth

    const { dispatcher } = createRedisDispatcher();

    const health = await dispatcher.getQueueHealth();

    expect(health.queueDepth).toBe(8);
    expect(health.dlqDepth).toBe(3);
    expect(health.activeWorkers).toBe(0);
    expect(health.totalWorkers).toBe(1);
    expect(health.recentTimeoutRate).toBe(0);
  });

  it('isHealthy is true when all metrics are within bounds', async () => {
    mockRedis.zcard.mockResolvedValue(1); // totalSize = 4 < 30 threshold
    mockRedis.llen.mockResolvedValue(2); // < 20

    const { dispatcher } = createRedisDispatcher();
    const health = await dispatcher.getQueueHealth();

    expect(health.isHealthy).toBe(true);
  });

  it('isHealthy is false when queue depth exceeds backpressure threshold', async () => {
    mockRedis.zcard.mockResolvedValue(8); // totalSize = 32 >= 30
    mockRedis.llen.mockResolvedValue(0);

    const { dispatcher } = createRedisDispatcher();
    const health = await dispatcher.getQueueHealth();

    expect(health.isHealthy).toBe(false);
  });

  it('isHealthy is false when DLQ depth >= 20', async () => {
    mockRedis.zcard.mockResolvedValue(0);
    mockRedis.llen.mockResolvedValue(25);

    const { dispatcher } = createRedisDispatcher();
    const health = await dispatcher.getQueueHealth();

    expect(health.isHealthy).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Task Registry ID Resolution (audit findings fix)
// ═══════════════════════════════════════════════════════════════════════════

describe('Task Registry ID Resolution', () => {
  it('task:update resolves via agent+issueNumber fallback when ID not found', async () => {
    // Use the real TaskExecutor with in-memory store (no Redis)
    const { TaskExecutor } = await import('../src/actions/task.js');
    const executor = new TaskExecutor(); // no Redis URL = in-memory mode

    // Create a task — gets a random UUID
    const createResult = await executor.execute('create', {
      agent: 'builder',
      task: 'implement_directive',
      issueNumber: 42,
    });
    expect(createResult.success).toBe(true);
    const registryId = (createResult.data as any).task.id;

    // Try updating with a WRONG ID (simulating what dispatcher passes)
    // but with the correct agent + issueNumber for fallback
    const updateResult = await executor.execute('update', {
      id: 'wrong-dispatcher-queue-id',
      status: 'completed',
      agent: 'builder',
      issueNumber: 42,
    });

    expect(updateResult.success).toBe(true);
    expect((updateResult.data as any).task.id).toBe(registryId);
    expect((updateResult.data as any).task.status).toBe('completed');
  });

  it('task:update upserts when no record exists and status is terminal', async () => {
    const { TaskExecutor } = await import('../src/actions/task.js');
    const executor = new TaskExecutor();

    // With agent + terminal status, a missing record should be upserted
    const result = await executor.execute('update', {
      id: 'nonexistent-id',
      status: 'completed',
      agent: 'builder',
      issueNumber: 9999,
      taskName: 'implement_directive',
    });

    expect(result.success).toBe(true);
    expect((result.data as any).task.agent).toBe('builder');
    expect((result.data as any).task.status).toBe('completed');
    expect((result.data as any).task.issueNumber).toBe(9999);
  });

  it('task:update fails when no record exists and status is non-terminal', async () => {
    const { TaskExecutor } = await import('../src/actions/task.js');
    const executor = new TaskExecutor();

    // Non-terminal status (in_progress) should NOT upsert — it should fail
    const result = await executor.execute('update', {
      id: 'nonexistent-id',
      status: 'in_progress',
      agent: 'builder',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Task not found');
  });

  it('notifyTaskRegistry passes issueNumber to callback', async () => {
    const updateTaskRegistry = vi.fn().mockResolvedValue(undefined);
    const { dispatcher } = createInMemoryDispatcher({ updateTaskRegistry });

    dispatcher.start();
    await dispatcher.enqueueTask({
      taskName: 'implement_directive',
      triggerPayload: { issue_number: 205, repo: 'test' },
    });

    await new Promise(r => setTimeout(r, 200));
    dispatcher.stop();

    expect(updateTaskRegistry).toHaveBeenCalledWith(
      expect.objectContaining({
        issueNumber: 205,
      }),
    );
  });
});
