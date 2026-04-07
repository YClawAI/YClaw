/**
 * Tests for Builder Dispatcher Phase 6: Queue Reliability & DLQ Recovery.
 *
 * Covers:
 *   1. Startup Recovery — orphaned QUEUED/ASSIGNED tasks re-enqueued
 *   2. DLQ Auto-Retry — eligible entries re-enqueued with backoff
 *   3. Task Dedup — duplicate events suppressed
 *   4. Capacity Backpressure — low-priority tasks rejected at thresholds
 *   5. Graceful Shutdown — busy worker tasks re-queued on SIGTERM
 *   6. DLQ Drain — one-time intelligent drain
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AgentConfig, AgentEvent, ExecutionRecord } from '../src/config/schema.js';

// ─── Mock Redis ─────────────────────────────────────────────────────────────

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
  get: vi.fn().mockResolvedValue(null),
  set: vi.fn().mockResolvedValue('OK'),
  del: vi.fn().mockResolvedValue(1),
  eval: vi.fn().mockResolvedValue(1),
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
    ],
    actions: ['codegen:execute'],
    data_sources: [],
    event_subscriptions: ['architect:build_directive', 'github:ci_fail'],
    event_publications: ['builder:pr_ready'],
    review_bypass: [],
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

function makeDispatcher(redisOverrides?: Record<string, unknown>, configOverrides?: Record<string, unknown>) {
  const redis = { ...mockRedis, ...redisOverrides };
  return new BuilderDispatcher(
    {
      redis: redis as any,
      executor: makeMockExecutor() as any,
      eventBus: makeMockEventBus() as any,
      builderConfig: makeBuilderConfig(),
    },
    { pollIntervalMs: 100000, ...configOverrides }, // Long poll to avoid auto-dispatch
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. Startup Recovery
// ═══════════════════════════════════════════════════════════════════════════

describe('Startup Recovery (TaskQueue.recoverOrphaned)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('re-enqueues ASSIGNED tasks found during scan', async () => {
    const taskData = {
      id: 'orphan-1',
      priority: '2',
      state: 'assigned',
      taskName: 'implement_issue',
      triggerPayload: '{}',
      sourceEvent: 'github:issue_assigned',
      correlationId: 'corr-1',
      createdAt: new Date().toISOString(),
      timeoutMs: '600000',
      workerId: 'dead-worker',
      assignedAt: new Date().toISOString(),
    };

    // First scan returns the orphaned task key, second scan returns cursor '0'
    mockRedis.scan.mockResolvedValueOnce(['0', ['builder:task:orphan-1']]);
    mockRedis.hgetall.mockResolvedValueOnce(taskData);

    const queue = new TaskQueue(mockRedis as any);
    const recovered = await queue.recoverOrphaned();

    expect(recovered).toBe(1);
    // Pipeline should have been called to reset state and re-add to ZSET
    expect(mockPipeline.hset).toHaveBeenCalledWith(
      'builder:task:orphan-1',
      expect.objectContaining({ state: 'queued' }),
    );
    expect(mockPipeline.zadd).toHaveBeenCalled();
  });

  it('discards tasks older than completedTtl', async () => {
    const staleDate = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(); // 2 hours ago
    const taskData = {
      id: 'stale-1',
      priority: '2',
      state: 'assigned',
      taskName: 'implement_issue',
      triggerPayload: '{}',
      sourceEvent: 'github:issue_assigned',
      correlationId: 'corr-1',
      createdAt: staleDate,
      timeoutMs: '600000',
    };

    mockRedis.scan.mockResolvedValueOnce(['0', ['builder:task:stale-1']]);
    mockRedis.hgetall.mockResolvedValueOnce(taskData);

    const queue = new TaskQueue(mockRedis as any, { completedTaskTtlSecs: 3600 });
    const recovered = await queue.recoverOrphaned();

    expect(recovered).toBe(0);
    // Should expire the stale task
    expect(mockRedis.expire).toHaveBeenCalledWith('builder:task:stale-1', 60);
  });

  it('skips COMPLETED tasks', async () => {
    const taskData = {
      id: 'done-1',
      priority: '2',
      state: 'completed',
      taskName: 'implement_issue',
      triggerPayload: '{}',
      sourceEvent: 'github:issue_assigned',
      correlationId: 'corr-1',
      createdAt: new Date().toISOString(),
      timeoutMs: '600000',
    };

    mockRedis.scan.mockResolvedValueOnce(['0', ['builder:task:done-1']]);
    mockRedis.hgetall.mockResolvedValueOnce(taskData);

    const queue = new TaskQueue(mockRedis as any);
    const recovered = await queue.recoverOrphaned();

    expect(recovered).toBe(0);
  });

  it('skips QUEUED tasks that are already in the ZSET', async () => {
    const taskData = {
      id: 'queued-1',
      priority: '2',
      state: 'queued',
      taskName: 'implement_issue',
      triggerPayload: '{}',
      sourceEvent: 'github:issue_assigned',
      correlationId: 'corr-1',
      createdAt: new Date().toISOString(),
      timeoutMs: '600000',
    };

    mockRedis.scan.mockResolvedValueOnce(['0', ['builder:task:queued-1']]);
    mockRedis.hgetall.mockResolvedValueOnce(taskData);
    mockRedis.zscore.mockResolvedValueOnce('123456'); // Present in ZSET

    const queue = new TaskQueue(mockRedis as any);
    const recovered = await queue.recoverOrphaned();

    expect(recovered).toBe(0);
  });

  it('returns 0 when Redis is null', async () => {
    const queue = new TaskQueue(null);
    const recovered = await queue.recoverOrphaned();
    expect(recovered).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. DLQ Auto-Retry
// ═══════════════════════════════════════════════════════════════════════════

describe('DLQ Auto-Retry (TaskQueue.retryEligibleDlqEntries)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('re-enqueues entries with retryCount < maxRetries and nextRetryAt <= now', async () => {
    const pastTime = new Date(Date.now() - 60000).toISOString();
    const dlqEntry = JSON.stringify({
      taskId: 'failed-1',
      taskName: 'fix_ci_failure',
      correlationId: 'corr-1',
      priority: 0,
      sourceEvent: 'github:ci_fail',
      error: 'timeout',
      failedAt: pastTime,
      durationMs: 300000,
      retryCount: 1,
      nextRetryAt: pastTime,
      maxRetries: 3,
      permanent: false,
      triggerPayload: { branch: 'agent/fix-1' },
    });

    mockRedis.lrange.mockResolvedValueOnce([dlqEntry]);

    const queue = new TaskQueue(mockRedis as any);
    const retried = await queue.retryEligibleDlqEntries(3);

    expect(retried).toBe(1);
    // Should have called pipeline to enqueue and rebuild DLQ
    expect(mockPipeline.exec).toHaveBeenCalled();
  });

  it('skips entries with nextRetryAt in the future', async () => {
    const futureTime = new Date(Date.now() + 600000).toISOString();
    const dlqEntry = JSON.stringify({
      taskId: 'failed-2',
      taskName: 'fix_ci_failure',
      correlationId: 'corr-2',
      priority: 0,
      sourceEvent: 'github:ci_fail',
      error: 'timeout',
      failedAt: new Date().toISOString(),
      durationMs: 300000,
      retryCount: 0,
      nextRetryAt: futureTime,
      maxRetries: 3,
      permanent: false,
    });

    mockRedis.lrange.mockResolvedValueOnce([dlqEntry]);

    const queue = new TaskQueue(mockRedis as any);
    const retried = await queue.retryEligibleDlqEntries(3);

    expect(retried).toBe(0);
  });

  it('marks entries as permanent when retryCount >= maxRetries', async () => {
    const pastTime = new Date(Date.now() - 60000).toISOString();
    const dlqEntry = JSON.stringify({
      taskId: 'failed-3',
      taskName: 'fix_ci_failure',
      correlationId: 'corr-3',
      priority: 0,
      sourceEvent: 'github:ci_fail',
      error: 'timeout',
      failedAt: pastTime,
      durationMs: 300000,
      retryCount: 3,
      nextRetryAt: pastTime,
      maxRetries: 3,
      permanent: false,
    });

    mockRedis.lrange.mockResolvedValueOnce([dlqEntry]);

    const queue = new TaskQueue(mockRedis as any);
    const retried = await queue.retryEligibleDlqEntries(3);

    expect(retried).toBe(0);
    // Entry should be kept but marked permanent
    expect(mockPipeline.exec).toHaveBeenCalled();
  });

  it('marks non-retryable errors as permanent', async () => {
    const pastTime = new Date(Date.now() - 60000).toISOString();
    const dlqEntry = JSON.stringify({
      taskId: 'failed-4',
      taskName: 'fix_ci_failure',
      correlationId: 'corr-4',
      priority: 0,
      sourceEvent: 'github:ci_fail',
      error: '401 unauthorized',
      failedAt: pastTime,
      durationMs: 300000,
      retryCount: 0,
      nextRetryAt: pastTime,
      maxRetries: 3,
      permanent: false,
    });

    mockRedis.lrange.mockResolvedValueOnce([dlqEntry]);

    const queue = new TaskQueue(mockRedis as any);
    const retried = await queue.retryEligibleDlqEntries(3);

    expect(retried).toBe(0);
    expect(mockPipeline.exec).toHaveBeenCalled();
  });

  it('returns 0 when Redis is null', async () => {
    const queue = new TaskQueue(null);
    const retried = await queue.retryEligibleDlqEntries(3);
    expect(retried).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. Task Dedup
// ═══════════════════════════════════════════════════════════════════════════

describe('Task Dedup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('suppresses duplicate events with same repo + issue_number', async () => {
    // First handleEvent: correlation dedup SET NX succeeds + event dedup SET NX succeeds
    mockRedis.set.mockResolvedValueOnce('OK');
    mockRedis.set.mockResolvedValueOnce('OK');
    // Second handleEvent: correlation dedup SET NX returns null (already exists) → suppressed
    mockRedis.set.mockResolvedValueOnce(null);

    const dispatcher = makeDispatcher();
    const event = makeEvent({
      payload: { issue_number: 205, repo: 'yclaw-protocol' },
    });

    const task1 = await dispatcher.handleEvent('architect:build_directive', event);
    expect(task1).not.toBeNull();

    const task2 = await dispatcher.handleEvent('architect:build_directive', event);
    expect(task2).toBeNull();
  });

  it('allows events with different identifiers', async () => {
    // Both SET NX calls succeed (different keys)
    mockRedis.set.mockResolvedValue('OK');

    const dispatcher = makeDispatcher();

    const event1 = makeEvent({
      payload: { issue_number: 205, repo: 'yclaw-protocol' },
    });
    const event2 = makeEvent({
      payload: { issue_number: 206, repo: 'yclaw-protocol' },
    });

    const task1 = await dispatcher.handleEvent('architect:build_directive', event1);
    const task2 = await dispatcher.handleEvent('architect:build_directive', event2);

    expect(task1).not.toBeNull();
    expect(task2).not.toBeNull();
  });

  it('allows events when payload has no stable identifiers', async () => {
    const dispatcher = makeDispatcher();
    const event = makeEvent({
      payload: {}, // No repo, no issue_number, no sha
    });

    // Should not attempt dedup — no stable key
    const task = await dispatcher.handleEvent('architect:build_directive', event);
    expect(task).not.toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. Capacity Backpressure
// ═══════════════════════════════════════════════════════════════════════════

describe('Capacity Backpressure', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: SET NX succeeds (no dedup block)
    mockRedis.set.mockResolvedValue('OK');
  });

  it('rejects P3 tasks when queue depth >= backpressureThreshold', async () => {
    // Queue depth = 30 (at threshold)
    mockRedis.zcard.mockResolvedValue(8); // 8 * 4 priority levels = checked, but
    // totalSize sums all 4 levels. Let's make it return 30 total.
    mockRedis.zcard.mockResolvedValueOnce(10) // P0
      .mockResolvedValueOnce(10) // P1
      .mockResolvedValueOnce(5)  // P2
      .mockResolvedValueOnce(5); // P3 = 30 total

    const dispatcher = makeDispatcher({}, {
      backpressureThreshold: 30,
      maxQueueDepth: 50,
    });

    const event = makeEvent({
      source: 'claudeception',
      type: 'reflect',
      payload: { repo: 'test' },
    });

    const task = await dispatcher.handleEvent('claudeception:reflect', event);
    expect(task).toBeNull(); // self_reflection is P3, should be rejected
  });

  it('accepts P0 tasks even when queue is full', async () => {
    // Queue depth = 50 (at max)
    mockRedis.zcard.mockResolvedValueOnce(20) // P0
      .mockResolvedValueOnce(15) // P1
      .mockResolvedValueOnce(10) // P2
      .mockResolvedValueOnce(5); // P3 = 50 total

    const dispatcher = makeDispatcher({}, {
      backpressureThreshold: 30,
      maxQueueDepth: 50,
    });

    const event = makeEvent({
      source: 'github',
      type: 'ci_fail',
      payload: { branch: 'agent/fix-1', repo: 'test' },
    });

    const task = await dispatcher.handleEvent('github:ci_fail', event);
    expect(task).not.toBeNull(); // P0 should be accepted even at max depth
  });

  it('accepts P2 tasks when queue depth < backpressureThreshold', async () => {
    // Queue depth = 10 (well below threshold)
    mockRedis.zcard.mockResolvedValueOnce(3)
      .mockResolvedValueOnce(3)
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(2); // = 10 total

    const dispatcher = makeDispatcher({}, {
      backpressureThreshold: 30,
      maxQueueDepth: 50,
    });

    const event = makeEvent({
      payload: { issue_number: 300, repo: 'test-repo' },
    });

    const task = await dispatcher.handleEvent('architect:build_directive', event);
    expect(task).not.toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. Graceful Shutdown Re-queue
// ═══════════════════════════════════════════════════════════════════════════

describe('Graceful Shutdown (re-queue mechanism)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('addToQueue + updateTask correctly re-queues a running task', async () => {
    const queue = new TaskQueue(mockRedis as any);

    const task = {
      id: 'inflight-1',
      priority: Priority.P2_IMPLEMENTATION,
      state: TaskState.RUNNING as TaskState,
      taskName: 'implement_issue',
      triggerPayload: { issue: 205 },
      sourceEvent: 'github:issue_assigned',
      correlationId: 'corr-1',
      createdAt: new Date().toISOString(),
      timeoutMs: 600000,
      workerId: 'worker-0',
    };

    // Simulate the re-queue path from stopGracefully:
    // 1. Update task state to QUEUED
    await queue.updateTask(task.id, {
      state: TaskState.QUEUED,
      workerId: '',
      assignedAt: '',
    });

    // 2. Re-add to priority ZSET
    await queue.addToQueue({ ...task, state: TaskState.QUEUED });

    // Verify updateTask set the state
    expect(mockRedis.hset).toHaveBeenCalledWith(
      'builder:task:inflight-1',
      expect.objectContaining({ state: 'queued' }),
    );

    // Verify addToQueue called zadd on the correct ZSET
    expect(mockRedis.zadd).toHaveBeenCalledWith(
      'builder:task_queue:P2',
      expect.any(String),
      'inflight-1',
    );
  });

  it('stopGracefully clears dlqRetryTimer', async () => {
    const dispatcher = makeDispatcher();
    dispatcher.start();

    // Verify timers are active
    expect(dispatcher.getStatus().running).toBe(true);

    await dispatcher.stopGracefully(100);

    expect(dispatcher.getStatus().running).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. DLQ Drain
// ═══════════════════════════════════════════════════════════════════════════

describe('DLQ Drain (TaskQueue.drainDlq)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('retries timeout errors and purges old entries', async () => {
    const recentTimeout = JSON.stringify({
      taskId: 'timeout-1',
      taskName: 'fix_ci_failure',
      correlationId: 'corr-1',
      priority: 0,
      sourceEvent: 'github:ci_fail',
      error: 'timeout',
      failedAt: new Date().toISOString(),
      durationMs: 300000,
      retryCount: 0,
      maxRetries: 3,
      permanent: false,
      triggerPayload: { branch: 'agent/fix-1' },
    });

    const oldEntry = JSON.stringify({
      taskId: 'old-1',
      taskName: 'implement_issue',
      correlationId: 'corr-2',
      priority: 2,
      sourceEvent: 'github:issue_assigned',
      error: 'LLM API error',
      failedAt: new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString(), // 72h ago
      durationMs: 120000,
      retryCount: 0,
      maxRetries: 3,
      permanent: false,
    });

    const permanentEntry = JSON.stringify({
      taskId: 'perm-1',
      taskName: 'implement_issue',
      correlationId: 'corr-3',
      priority: 2,
      sourceEvent: 'github:issue_assigned',
      error: 'missing repo',
      failedAt: new Date().toISOString(),
      durationMs: 5000,
      retryCount: 0,
      maxRetries: 3,
      permanent: false,
    });

    mockRedis.lrange.mockResolvedValueOnce([recentTimeout, oldEntry, permanentEntry]);

    const queue = new TaskQueue(mockRedis as any);
    const result = await queue.drainDlq({ maxRetries: 3 });

    expect(result.retried).toBe(1);   // timeout-1 retried
    expect(result.purged).toBe(2);     // old-1 (>48h) + perm-1 (permanent error)
  });

  it('does not modify DLQ in dryRun mode', async () => {
    const entry = JSON.stringify({
      taskId: 'dry-1',
      taskName: 'fix_ci_failure',
      correlationId: 'corr-1',
      priority: 0,
      sourceEvent: 'github:ci_fail',
      error: 'timeout',
      failedAt: new Date().toISOString(),
      durationMs: 300000,
      retryCount: 0,
      maxRetries: 3,
      permanent: false,
    });

    mockRedis.lrange.mockResolvedValueOnce([entry]);

    const queue = new TaskQueue(mockRedis as any);
    const result = await queue.drainDlq({ dryRun: true, maxRetries: 3 });

    expect(result.retried).toBe(1);
    // Pipeline should NOT have been called to modify DLQ
    expect(mockPipeline.del).not.toHaveBeenCalled();
  });

  it('returns zeros when DLQ is empty', async () => {
    mockRedis.lrange.mockResolvedValueOnce([]);

    const queue = new TaskQueue(mockRedis as any);
    const result = await queue.drainDlq({ maxRetries: 3 });

    expect(result.retried).toBe(0);
    expect(result.purged).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// addToQueue + totalSize
// ═══════════════════════════════════════════════════════════════════════════

describe('TaskQueue helpers (Phase 6)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('addToQueue adds task to Redis ZSET', async () => {
    const queue = new TaskQueue(mockRedis as any);
    await queue.addToQueue({
      id: 'requeue-1',
      priority: Priority.P2_IMPLEMENTATION,
      state: TaskState.QUEUED,
      taskName: 'implement_issue',
      triggerPayload: {},
      sourceEvent: 'manual',
      correlationId: 'corr-1',
      createdAt: new Date().toISOString(),
      timeoutMs: 600000,
    });

    expect(mockRedis.zadd).toHaveBeenCalledWith(
      'builder:task_queue:P2',
      expect.any(String),
      'requeue-1',
    );
  });

  it('totalSize delegates to size()', async () => {
    mockRedis.zcard.mockResolvedValue(5);
    const queue = new TaskQueue(mockRedis as any);
    const total = await queue.totalSize();
    expect(total).toBe(20); // 5 per priority level * 4 levels
  });

  it('addToQueue works with in-memory fallback', async () => {
    const queue = new TaskQueue(null);
    await queue.addToQueue({
      id: 'mem-1',
      priority: Priority.P1_REVIEW,
      state: TaskState.QUEUED,
      taskName: 'address_review_feedback',
      triggerPayload: {},
      sourceEvent: 'manual',
      correlationId: 'corr-1',
      createdAt: new Date().toISOString(),
      timeoutMs: 600000,
    });

    const size = await queue.size();
    expect(size).toBe(1);
  });
});
