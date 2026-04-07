/**
 * Tests for Builder Dispatcher-Worker architecture.
 *
 * Covers: task queue priority ordering, worker lifecycle, dispatcher event
 * routing, timeout handling, and concurrent worker independence.
 *
 * Mocks Redis and AgentExecutor to test orchestration logic in isolation.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AgentConfig, AgentEvent, ExecutionRecord } from '../src/config/schema.js';

// ─── Mock Redis Pipeline ────────────────────────────────────────────────────

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
  zrangebyscore: vi.fn().mockResolvedValue([]),
  zcard: vi.fn().mockResolvedValue(0),
  zadd: vi.fn().mockResolvedValue(1),
  zrem: vi.fn().mockResolvedValue(1),
  hgetall: vi.fn().mockResolvedValue({}),
  hset: vi.fn().mockResolvedValue(1),
  expire: vi.fn().mockResolvedValue(1),
  // Used by SessionStore (ACP session lifecycle)
  get: vi.fn().mockResolvedValue(null),   // getSessionForThread → no existing session
  set: vi.fn().mockResolvedValue('OK'),   // acquireLock + thread registration
  del: vi.fn().mockResolvedValue(1),
  eval: vi.fn().mockResolvedValue(1),     // Lua compare-and-del lock release
};

// ─── Mock Logger ────────────────────────────────────────────────────────────

vi.mock('../src/logging/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// ─── Import after mocks ────────────────────────────────────────────────────

const { TaskQueue } = await import('../src/builder/task-queue.js');
const { CodingWorker } = await import('../src/builder/worker.js');
const { BuilderDispatcher } = await import('../src/builder/dispatcher.js');
const { Priority, TaskState, EVENT_TASK_MAP } = await import('../src/builder/types.js');

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
      { type: 'event', event: 'github:pr_review_comment', task: 'address_review_feedback' },
      { type: 'cron', schedule: '4 13 * * *', task: 'daily_standup' },
    ],
    actions: ['codegen:execute', 'github:create_pr'],
    data_sources: [],
    event_subscriptions: ['architect:build_directive', 'github:ci_fail'],
    event_publications: ['builder:pr_ready'],
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

function makeEvent(overrides?: Partial<AgentEvent>): AgentEvent {
  return {
    id: 'evt-123',
    source: 'architect',
    type: 'build_directive',
    payload: { issue_number: 205, repo: 'yclaw-protocol' },
    timestamp: new Date().toISOString(),
    correlationId: 'corr-123',
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

// ═══════════════════════════════════════════════════════════════════════════
// TaskQueue Tests
// ═══════════════════════════════════════════════════════════════════════════

describe('TaskQueue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('enqueue', () => {
    it('creates a task with correct fields and adds to Redis', async () => {
      const queue = new TaskQueue(mockRedis as any);

      const task = await queue.enqueue({
        taskName: 'implement_issue',
        priority: Priority.P2_IMPLEMENTATION,
        sourceEvent: 'architect:build_directive',
        triggerPayload: { issue_number: 205 },
        correlationId: 'corr-1',
      });

      expect(task.id).toBeDefined();
      expect(task.taskName).toBe('implement_issue');
      expect(task.priority).toBe(Priority.P2_IMPLEMENTATION);
      expect(task.state).toBe(TaskState.QUEUED);
      expect(task.sourceEvent).toBe('architect:build_directive');
      expect(task.correlationId).toBe('corr-1');

      // Pipeline should have been called with hset + zadd
      expect(mockPipeline.hset).toHaveBeenCalled();
      expect(mockPipeline.zadd).toHaveBeenCalled();
      expect(mockPipelineExec).toHaveBeenCalled();
    });

    it('generates a correlationId when none is provided', async () => {
      const queue = new TaskQueue(mockRedis as any);

      const task = await queue.enqueue({
        taskName: 'implement_issue',
        priority: Priority.P2_IMPLEMENTATION,
        sourceEvent: 'architect:build_directive',
        triggerPayload: {},
      });

      expect(task.correlationId).toBeDefined();
      expect(task.correlationId.length).toBeGreaterThan(0);
    });
  });

  describe('dequeue', () => {
    it('returns null when queue is empty', async () => {
      mockRedis.zpopmin.mockResolvedValueOnce([]);
      const queue = new TaskQueue(mockRedis as any);

      const task = await queue.dequeue();
      expect(task).toBeNull();
    });

    it('dequeues and transitions task to ASSIGNED state', async () => {
      const taskId = 'task-abc';
      mockRedis.zpopmin.mockResolvedValueOnce([taskId, '20000000000000']);
      mockRedis.hgetall.mockResolvedValueOnce({
        id: taskId,
        priority: '2',
        state: 'queued',
        taskName: 'implement_issue',
        triggerPayload: '{"issue": 205}',
        sourceEvent: 'architect:build_directive',
        correlationId: 'corr-1',
        createdAt: new Date().toISOString(),
        timeoutMs: '600000',
      });

      const queue = new TaskQueue(mockRedis as any);
      const task = await queue.dequeue();

      expect(task).not.toBeNull();
      expect(task!.id).toBe(taskId);
      expect(task!.state).toBe(TaskState.ASSIGNED);
      expect(task!.assignedAt).toBeDefined();

      // Should update the hash with new state
      expect(mockRedis.hset).toHaveBeenCalledWith(
        expect.stringContaining(taskId),
        expect.objectContaining({ state: 'assigned' }),
      );
    });
  });

  describe('updateTask', () => {
    it('sets TTL on terminal states', async () => {
      const queue = new TaskQueue(mockRedis as any);

      await queue.updateTask('task-1', {
        state: TaskState.COMPLETED,
        completedAt: new Date().toISOString(),
      });

      expect(mockRedis.expire).toHaveBeenCalledWith(
        expect.stringContaining('task-1'),
        3600,
      );
    });

    it('does not set TTL on non-terminal states', async () => {
      const queue = new TaskQueue(mockRedis as any);

      await queue.updateTask('task-1', {
        state: TaskState.RUNNING,
        workerId: 'worker-1',
      });

      expect(mockRedis.expire).not.toHaveBeenCalled();
    });
  });

  describe('size', () => {
    it('returns the queue length from Redis ZCARD', async () => {
      mockRedis.zcard.mockResolvedValueOnce(5);
      const queue = new TaskQueue(mockRedis as any);

      const size = await queue.size();
      expect(size).toBe(5);
    });
  });

  describe('null Redis (in-memory fallback)', () => {
    it('enqueue works without Redis', async () => {
      const queue = new TaskQueue(null);

      const task = await queue.enqueue({
        taskName: 'test',
        priority: Priority.P2_IMPLEMENTATION,
        sourceEvent: 'manual',
        triggerPayload: {},
      });

      expect(task.id).toBeDefined();
      expect(task.state).toBe(TaskState.QUEUED);
    });

    it('dequeue returns null without Redis', async () => {
      const queue = new TaskQueue(null);
      const task = await queue.dequeue();
      expect(task).toBeNull();
    });

    it('size returns 0 without Redis', async () => {
      const queue = new TaskQueue(null);
      const size = await queue.size();
      expect(size).toBe(0);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// CodingWorker Tests
// ═══════════════════════════════════════════════════════════════════════════

describe('CodingWorker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('starts idle and transitions to busy during execution', async () => {
    const mockExecutor = makeMockExecutor();
    const worker = new CodingWorker({
      executor: mockExecutor as any,
      builderConfig: makeBuilderConfig(),
    });

    expect(worker.isIdle).toBe(true);
    expect(worker.isBusy).toBe(false);

    const executePromise = worker.execute({
      id: 'task-1',
      priority: Priority.P2_IMPLEMENTATION,
      state: TaskState.ASSIGNED,
      taskName: 'implement_issue',
      triggerPayload: { issue: 205 },
      sourceEvent: 'architect:build_directive',
      correlationId: 'corr-1',
      createdAt: new Date().toISOString(),
      timeoutMs: 60000,
    });

    // After execute resolves, worker should be idle again
    const result = await executePromise;
    expect(worker.isIdle).toBe(true);
    expect(result.state).toBe(TaskState.COMPLETED);
    expect(result.taskId).toBe('task-1');
  });

  it('returns FAILED when executor throws', async () => {
    const mockExecutor = makeMockExecutor();
    mockExecutor.execute.mockRejectedValueOnce(new Error('LLM API error'));

    const worker = new CodingWorker({
      executor: mockExecutor as any,
      builderConfig: makeBuilderConfig(),
    });

    const result = await worker.execute({
      id: 'task-2',
      priority: Priority.P0_SAFETY,
      state: TaskState.ASSIGNED,
      taskName: 'fix_ci_failure',
      triggerPayload: {},
      sourceEvent: 'github:ci_fail',
      correlationId: 'corr-2',
      createdAt: new Date().toISOString(),
      timeoutMs: 60000,
    });

    expect(result.state).toBe(TaskState.FAILED);
    expect(result.error).toBe('LLM API error');
    expect(worker.isIdle).toBe(true); // Recovered
  });

  it('returns FAILED when execution record has failed status', async () => {
    const mockExecutor = makeMockExecutor(
      makeExecutionRecord({ status: 'failed', error: 'Build failed' }),
    );

    const worker = new CodingWorker({
      executor: mockExecutor as any,
      builderConfig: makeBuilderConfig(),
    });

    const result = await worker.execute({
      id: 'task-3',
      priority: Priority.P2_IMPLEMENTATION,
      state: TaskState.ASSIGNED,
      taskName: 'implement_issue',
      triggerPayload: {},
      sourceEvent: 'architect:build_directive',
      correlationId: 'corr-3',
      createdAt: new Date().toISOString(),
      timeoutMs: 60000,
    });

    expect(result.state).toBe(TaskState.FAILED);
  });

  it('returns TIMEOUT when task exceeds timeout', async () => {
    const mockExecutor = makeMockExecutor();
    // Make execute hang until aborted (respects AbortSignal)
    mockExecutor.execute.mockImplementationOnce(
      (_config: any, _task: any, _trigger: any, _payload: any, _model: any, signal?: AbortSignal) =>
        new Promise((resolve, reject) => {
          const timer = setTimeout(resolve, 30000); // long hang
          if (signal) {
            signal.addEventListener('abort', () => {
              clearTimeout(timer);
              reject(new Error('Task timed out — aborted by signal'));
            });
          }
        }),
    );

    const worker = new CodingWorker({
      executor: mockExecutor as any,
      builderConfig: makeBuilderConfig(),
    });

    const result = await worker.execute({
      id: 'task-4',
      priority: Priority.P2_IMPLEMENTATION,
      state: TaskState.ASSIGNED,
      taskName: 'implement_issue',
      triggerPayload: {},
      sourceEvent: 'architect:build_directive',
      correlationId: 'corr-4',
      createdAt: new Date().toISOString(),
      timeoutMs: 50, // Very short timeout
    });

    expect(result.state).toBe(TaskState.TIMEOUT);
    expect(result.error).toContain('timed out');
    expect(worker.isIdle).toBe(true);
  });

  it('throws when executing on a busy worker', async () => {
    const mockExecutor = makeMockExecutor();
    // Make first execute hang until aborted
    mockExecutor.execute.mockImplementationOnce(
      (_config: any, _task: any, _trigger: any, _payload: any, _model: any, signal?: AbortSignal) =>
        new Promise((resolve, reject) => {
          const timer = setTimeout(resolve, 30000);
          if (signal) {
            signal.addEventListener('abort', () => {
              clearTimeout(timer);
              reject(new Error('Aborted'));
            });
          }
        }),
    );

    const worker = new CodingWorker({
      executor: mockExecutor as any,
      builderConfig: makeBuilderConfig(),
    });

    const task = {
      id: 'task-5',
      priority: Priority.P2_IMPLEMENTATION,
      state: TaskState.ASSIGNED as const,
      taskName: 'implement_issue',
      triggerPayload: {},
      sourceEvent: 'architect:build_directive',
      correlationId: 'corr-5',
      createdAt: new Date().toISOString(),
      timeoutMs: 5000,
    };

    // Start first task (will hang)
    const firstTask = worker.execute(task);

    // Try to start second task — should throw
    await expect(worker.execute({ ...task, id: 'task-6' })).rejects.toThrow(
      /not idle/,
    );

    // Clean up: stop the first task
    worker.stop();
    await firstTask;
  });

  it('injects correlationId and dispatcher meta into payload', async () => {
    const mockExecutor = makeMockExecutor();
    const worker = new CodingWorker({
      executor: mockExecutor as any,
      builderConfig: makeBuilderConfig(),
    });

    await worker.execute({
      id: 'task-7',
      priority: Priority.P2_IMPLEMENTATION,
      state: TaskState.ASSIGNED,
      taskName: 'implement_issue',
      triggerPayload: { issue: 100 },
      sourceEvent: 'architect:build_directive',
      correlationId: 'corr-7',
      createdAt: new Date().toISOString(),
      timeoutMs: 60000,
    });

    const callArgs = mockExecutor.execute.mock.calls[0]!;
    const payload = callArgs[3] as Record<string, unknown>;

    expect(payload.correlationId).toBe('corr-7');
    expect(payload.issue).toBe(100);
    expect(payload._dispatcherMeta).toEqual(
      expect.objectContaining({
        taskId: 'task-7',
        priority: Priority.P2_IMPLEMENTATION,
      }),
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// BuilderDispatcher Tests
// ═══════════════════════════════════════════════════════════════════════════

describe('BuilderDispatcher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates workers on construction', () => {
    const dispatcher = new BuilderDispatcher(
      {
        redis: null,
        executor: makeMockExecutor() as any,
        eventBus: makeMockEventBus() as any,
        builderConfig: makeBuilderConfig(),
      },
      { maxConcurrentWorkers: 2 },
    );

    const status = dispatcher.getStatus();
    expect(status.workers).toHaveLength(2);
    expect(status.workers.every(w => w.state === 'idle')).toBe(true);
  });

  it('does not subscribe to event bus (routing via direct handleEvent calls)', () => {
    const mockEventBus = makeMockEventBus();
    const dispatcher = new BuilderDispatcher({
      redis: null,
      executor: makeMockExecutor() as any,
      eventBus: mockEventBus as any,
      builderConfig: makeBuilderConfig(),
    });

    dispatcher.start();

    // Issue #5 fix: dead dispatcher:* subscriptions removed.
    // All routing happens via direct handleEvent calls in main.ts.
    expect(mockEventBus.subscribe).not.toHaveBeenCalled();

    dispatcher.stop();
  });

  it('handleEvent enqueues a task with correct priority', async () => {
    const dispatcher = new BuilderDispatcher(
      {
        redis: mockRedis as any,
        executor: makeMockExecutor() as any,
        eventBus: makeMockEventBus() as any,
        builderConfig: makeBuilderConfig(),
      },
      { pollIntervalMs: 100000 }, // Long poll to avoid auto-dispatch
    );

    const event = makeEvent();
    const task = await dispatcher.handleEvent('architect:build_directive', event);

    expect(task).not.toBeNull();
    expect(task!.taskName).toBe('implement_directive');
    expect(task!.priority).toBe(Priority.P2_IMPLEMENTATION);
    expect(task!.sourceEvent).toBe('architect:build_directive');
  });

  it('handleEvent maps CI failure to P0 priority', async () => {
    const dispatcher = new BuilderDispatcher(
      {
        redis: mockRedis as any,
        executor: makeMockExecutor() as any,
        eventBus: makeMockEventBus() as any,
        builderConfig: makeBuilderConfig(),
      },
      { pollIntervalMs: 100000 },
    );

    const event = makeEvent({
      source: 'github',
      type: 'ci_fail',
      payload: { branch: 'agent/fix-123' },
    });

    const task = await dispatcher.handleEvent('github:ci_fail', event);

    expect(task).not.toBeNull();
    expect(task!.taskName).toBe('fix_ci_failure');
    expect(task!.priority).toBe(Priority.P0_SAFETY);
  });

  it('handleEvent returns null for unknown events', async () => {
    const dispatcher = new BuilderDispatcher({
      redis: null,
      executor: makeMockExecutor() as any,
      eventBus: makeMockEventBus() as any,
      builderConfig: makeBuilderConfig(),
    });

    const task = await dispatcher.handleEvent('unknown:event', makeEvent());
    expect(task).toBeNull();
  });

  it('enqueueTask creates a manual task', async () => {
    const dispatcher = new BuilderDispatcher(
      {
        redis: mockRedis as any,
        executor: makeMockExecutor() as any,
        eventBus: makeMockEventBus() as any,
        builderConfig: makeBuilderConfig(),
      },
      { pollIntervalMs: 100000 },
    );

    const task = await dispatcher.enqueueTask({
      taskName: 'daily_standup',
      triggerPayload: { date: '2026-02-25' },
    });

    expect(task.taskName).toBe('daily_standup');
    expect(task.priority).toBe(Priority.P3_BACKGROUND);
    expect(task.sourceEvent).toBe('manual');
  });

  it('getStatus returns correct worker state', async () => {
    const dispatcher = new BuilderDispatcher(
      {
        redis: null,
        executor: makeMockExecutor() as any,
        eventBus: makeMockEventBus() as any,
        builderConfig: makeBuilderConfig(),
      },
      { maxConcurrentWorkers: 3 },
    );

    const status = dispatcher.getStatus();
    expect(status.running).toBe(false);
    expect(status.workers).toHaveLength(3);
    expect(status.recentResults).toHaveLength(0);
  });

  it('stop signals all busy workers', () => {
    const dispatcher = new BuilderDispatcher({
      redis: null,
      executor: makeMockExecutor() as any,
      eventBus: makeMockEventBus() as any,
      builderConfig: makeBuilderConfig(),
    });

    dispatcher.start();
    expect(dispatcher.getStatus().running).toBe(true);

    dispatcher.stop();
    expect(dispatcher.getStatus().running).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Priority Ordering Tests
// ═══════════════════════════════════════════════════════════════════════════

describe('Priority ordering', () => {
  it('P0 tasks have lower score than P1 tasks', () => {
    // Score formula: priority * 1e13 + timestamp
    const now = Date.now();
    const p0Score = Priority.P0_SAFETY * 1e13 + now;
    const p1Score = Priority.P1_REVIEW * 1e13 + now;
    const p2Score = Priority.P2_IMPLEMENTATION * 1e13 + now;
    const p3Score = Priority.P3_BACKGROUND * 1e13 + now;

    expect(p0Score).toBeLessThan(p1Score);
    expect(p1Score).toBeLessThan(p2Score);
    expect(p2Score).toBeLessThan(p3Score);
  });

  it('earlier tasks within same priority have lower score', () => {
    const earlier = Priority.P2_IMPLEMENTATION * 1e13 + 1000;
    const later = Priority.P2_IMPLEMENTATION * 1e13 + 2000;

    expect(earlier).toBeLessThan(later);
  });

  it('P0 from the future beats P3 from the past', () => {
    const p0Future = Priority.P0_SAFETY * 1e13 + 9999999999999;
    const p3Past = Priority.P3_BACKGROUND * 1e13 + 1;

    expect(p0Future).toBeLessThan(p3Past);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// EVENT_TASK_MAP Tests
// ═══════════════════════════════════════════════════════════════════════════

describe('EVENT_TASK_MAP', () => {
  it('maps all expected Builder event subscriptions', () => {
    expect(EVENT_TASK_MAP['architect:build_directive']).toBe('implement_directive');
    expect(EVENT_TASK_MAP['github:pr_review_comment']).toBe('address_review_feedback');
    expect(EVENT_TASK_MAP['github:ci_fail']).toBe('fix_ci_failure');
    expect(EVENT_TASK_MAP['github:pr_review_submitted']).toBe('address_human_review');
    expect(EVENT_TASK_MAP['claudeception:reflect']).toBe('self_reflection');
  });
});
