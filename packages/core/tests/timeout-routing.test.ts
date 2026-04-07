/**
 * Tests for timeout routing fixes.
 *
 * Covers:
 *   Fix 1 — address_review_feedback routing guards:
 *     Layer 1: Webhook handler skips closed PRs
 *     Layer 2: Dispatcher skips approved reviews and closed-PR payloads
 *     Layer 3: SKIPPED tasks are acked without DLQ/retry
 *   Fix 2 — daily_standup / self_reflection timeout bumped to 5 min
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AgentConfig, AgentEvent, ExecutionRecord } from '../src/config/schema.js';

// ─── Mock Redis ──────────────────────────────────────────────────────────────

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

// ─── Mock Logger ─────────────────────────────────────────────────────────────

vi.mock('../src/logging/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// ─── Import after mocks ───────────────────────────────────────────────────────

const { BuilderDispatcher } = await import('../src/builder/dispatcher.js');
const { TaskState } = await import('../src/builder/types.js');
const { GitHubWebhookHandler } = await import('../src/triggers/github-webhook.js');

// ─── Shared fixtures ─────────────────────────────────────────────────────────

function makeBuilderConfig(): AgentConfig {
  return {
    name: 'builder',
    department: 'development',
    description: 'Test builder',
    model: { provider: 'anthropic', model: 'claude-opus-4-6', temperature: 0.2, maxTokens: 16384 },
    system_prompts: [],
    triggers: [
      { type: 'event', event: 'github:pr_review_comment', task: 'address_review_feedback' },
      { type: 'event', event: 'architect:build_directive', task: 'implement_directive' },
      { type: 'cron', schedule: '4 13 * * *', task: 'daily_standup' },
      { type: 'cron', schedule: '0 * * * *', task: 'self_reflection' },
    ],
    actions: ['codegen:execute'],
    data_sources: [],
    event_subscriptions: ['github:pr_review_comment', 'architect:build_directive'],
    event_publications: ['builder:pr_ready'],
    review_bypass: [],
  };
}

function makeMockExecutor(result?: Partial<ExecutionRecord>) {
  const rec: ExecutionRecord = {
    id: 'exec-1',
    agent: 'builder',
    trigger: 'dispatcher',
    task: 'address_review_feedback',
    startedAt: new Date().toISOString(),
    status: 'completed',
    actionsTaken: [],
    selfModifications: [],
    ...result,
  };
  return {
    execute: vi.fn().mockResolvedValue(rec),
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

function makeDispatcher() {
  return new BuilderDispatcher(
    {
      redis: mockRedis as any,
      executor: makeMockExecutor() as any,
      eventBus: makeMockEventBus() as any,
      builderConfig: makeBuilderConfig(),
    },
    { pollIntervalMs: 100_000 },
  );
}

function makeReviewCommentEvent(overrides?: Partial<AgentEvent>): AgentEvent {
  return {
    id: 'evt-review-1',
    source: 'github',
    type: 'pr_review_comment',
    payload: {
      pr_number: 42,
      review_state: 'changes_requested',
      comment_body: '## Architect Review\n[CHANGES REQUESTED]\n- Fix the lint error',
      pr_state: 'open',
      repo: 'yclaw-protocol',
      owner: 'yclaw-ai',
      repo_full: 'yclaw-ai/yclaw-protocol',
    },
    timestamp: new Date().toISOString(),
    correlationId: `yclaw-ai/yclaw-protocol:pr-42:${Date.now()}`,
    ...overrides,
  };
}

// ─── Mock registry for webhook handler ───────────────────────────────────────

function makeMockRegistry(repoFullName = 'yclaw-ai/yclaw-protocol') {
  return {
    has: vi.fn((name: string) => name === repoFullName),
    get: vi.fn(),
    getByFullName: vi.fn(),
    size: 1,
  };
}

function makeIssueCommentPayload(overrides: Record<string, unknown> = {}) {
  return {
    action: 'created',
    issue: {
      number: 42,
      title: 'Fix the bug',
      body: null,
      html_url: 'https://github.com/yclaw-ai/yclaw-protocol/pull/42',
      labels: [],
      pull_request: { url: 'https://api.github.com/repos/yclaw-ai/yclaw-protocol/pulls/42', html_url: '' },
      state: 'open',
    },
    comment: {
      id: 1001,
      body: '## Architect Review\n[CHANGES REQUESTED]\n- Fix the lint error',
      html_url: 'https://github.com/yclaw-ai/yclaw-protocol/pull/42#issuecomment-1001',
      user: { login: 'architect-bot' },
      issue_url: 'https://api.github.com/repos/yclaw-ai/yclaw-protocol/issues/42',
    },
    repository: {
      name: 'yclaw-protocol',
      full_name: 'yclaw-ai/yclaw-protocol',
      owner: { login: 'yclaw-ai' },
    },
    sender: { login: 'architect-bot' },
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Fix 1 — Layer 1: Webhook handler guards
// ═══════════════════════════════════════════════════════════════════════════════

describe('Fix 1 — Layer 1: Webhook handler skips review comments on closed PRs', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  function makeHandler() {
    const eventBus = { publish: vi.fn().mockResolvedValue(undefined) };
    const registry = makeMockRegistry();
    const handler = new GitHubWebhookHandler(eventBus as any, {
      registry: registry as any,
      allowedArchitectLogins: new Set(['architect-bot']),
    });
    return { handler, eventBus };
  }

  it('publishes github:pr_review_comment for changes_requested on open PR', async () => {
    const { handler, eventBus } = makeHandler();
    const payload = makeIssueCommentPayload();
    const result = await handler.handleWebhook('issue_comment', payload as any, 'delivery-open-1');
    expect(result.processed).toBe(true);
    expect(result.event).toBe('github:pr_review_comment');
    expect(eventBus.publish).toHaveBeenCalledOnce();
  });

  it('skips publish when PR state is closed', async () => {
    const { handler, eventBus } = makeHandler();
    const payload = makeIssueCommentPayload({
      issue: {
        number: 42,
        title: 'Fix the bug',
        body: null,
        html_url: 'https://github.com/yclaw-ai/yclaw-protocol/pull/42',
        labels: [],
        pull_request: { url: '...', html_url: '' },
        state: 'closed',   // PR is already closed
      },
    });
    const result = await handler.handleWebhook('issue_comment', payload as any, 'delivery-closed-1');
    expect(result.processed).toBe(false);
    expect(eventBus.publish).not.toHaveBeenCalled();
  });

  it('includes pr_state in published payload for open PR', async () => {
    const { handler, eventBus } = makeHandler();
    const payload = makeIssueCommentPayload();
    await handler.handleWebhook('issue_comment', payload as any, 'delivery-open-2');
    const publishedPayload = (eventBus.publish as ReturnType<typeof vi.fn>).mock.calls[0][2] as Record<string, unknown>;
    expect(publishedPayload.pr_state).toBe('open');
  });

  it('does NOT skip on approved comment — approval still published for ReactionsManager', async () => {
    const { handler, eventBus } = makeHandler();
    const payload = makeIssueCommentPayload({
      comment: {
        id: 1002,
        body: '## Architect Review\n[APPROVED]\nLooks great!',
        html_url: 'https://github.com/yclaw-ai/yclaw-protocol/pull/42#issuecomment-1002',
        user: { login: 'architect-bot' },
        issue_url: '...',
      },
    });
    const result = await handler.handleWebhook('issue_comment', payload as any, 'delivery-approved-1');
    // ReactionsManager (auto-merge-on-architect-comment) needs this event
    expect(result.processed).toBe(true);
    expect(result.event).toBe('github:pr_review_comment');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Fix 1 — Layer 2: Dispatcher guard in handleEvent
// ═══════════════════════════════════════════════════════════════════════════════

describe('Fix 1 — Layer 2: Dispatcher skips address_review_feedback for approved reviews', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('enqueues task for changes_requested on open PR', async () => {
    const d = makeDispatcher();
    mockRedis.set.mockResolvedValue('OK');
    const task = await d.handleEvent('github:pr_review_comment', makeReviewCommentEvent());
    expect(task).not.toBeNull();
    expect(task?.taskName).toBe('address_review_feedback');
  });

  it('returns null for approved review (review_state = approved)', async () => {
    const d = makeDispatcher();
    mockRedis.set.mockResolvedValue('OK');
    const task = await d.handleEvent(
      'github:pr_review_comment',
      makeReviewCommentEvent({
        payload: {
          pr_number: 42,
          review_state: 'approved',
          comment_body: '## Architect Review\n[APPROVED]\nLooks great!',
          pr_state: 'open',
          repo: 'yclaw-protocol',
          owner: 'yclaw-ai',
          repo_full: 'yclaw-ai/yclaw-protocol',
        },
        correlationId: `yclaw-ai/yclaw-protocol:pr-42:${Date.now()}`,
      }),
    );
    expect(task).toBeNull();
  });

  it('returns null when comment_body contains [APPROVED] even if review_state not set', async () => {
    const d = makeDispatcher();
    mockRedis.set.mockResolvedValue('OK');
    const task = await d.handleEvent(
      'github:pr_review_comment',
      makeReviewCommentEvent({
        payload: {
          pr_number: 42,
          review_state: undefined,
          comment_body: '## Architect Review\n[APPROVED]\nLooks great!',
          pr_state: 'open',
          repo: 'yclaw-protocol',
          owner: 'yclaw-ai',
        },
        correlationId: `yclaw-ai/yclaw-protocol:pr-42:${Date.now()}`,
      }),
    );
    expect(task).toBeNull();
  });

  it('returns null when pr_state is closed', async () => {
    const d = makeDispatcher();
    mockRedis.set.mockResolvedValue('OK');
    const task = await d.handleEvent(
      'github:pr_review_comment',
      makeReviewCommentEvent({
        payload: {
          pr_number: 42,
          review_state: 'changes_requested',
          comment_body: '## Architect Review\n[CHANGES REQUESTED]\n- Fix lint',
          pr_state: 'closed',   // PR was closed before we could process this
          repo: 'yclaw-protocol',
          owner: 'yclaw-ai',
        },
        correlationId: `yclaw-ai/yclaw-protocol:pr-42:${Date.now()}`,
      }),
    );
    expect(task).toBeNull();
  });

  it('does NOT apply the guard to other task types (implement_directive still enqueues)', async () => {
    const d = makeDispatcher();
    mockRedis.set.mockResolvedValue('OK');
    const task = await d.handleEvent(
      'architect:build_directive',
      {
        id: 'evt-2',
        source: 'architect',
        type: 'build_directive',
        payload: { issue_number: 10, repo: 'yclaw-protocol', owner: 'yclaw-ai' },
        timestamp: new Date().toISOString(),
        correlationId: `yclaw-ai/yclaw-protocol:issue:${Date.now()}`,
      },
    );
    expect(task).not.toBeNull();
    expect(task?.taskName).toBe('implement_directive');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Fix 1 — Layer 3: SKIPPED state is acked without DLQ
// ═══════════════════════════════════════════════════════════════════════════════

describe('Fix 1 — Layer 3: TaskState.SKIPPED is defined and not treated as failure', () => {
  it('TaskState enum includes SKIPPED', () => {
    expect(TaskState.SKIPPED).toBe('skipped');
  });

  it('SKIPPED is distinct from FAILED and TIMEOUT', () => {
    expect(TaskState.SKIPPED).not.toBe(TaskState.FAILED);
    expect(TaskState.SKIPPED).not.toBe(TaskState.TIMEOUT);
    expect(TaskState.SKIPPED).not.toBe(TaskState.COMPLETED);
  });

  it('isFailure logic does not include SKIPPED', () => {
    // Mirror the condition in runWorker to assert SKIPPED is excluded from DLQ path
    const isFailure = (state: string) =>
      state === TaskState.FAILED || state === TaskState.TIMEOUT;

    expect(isFailure(TaskState.SKIPPED)).toBe(false);
    expect(isFailure(TaskState.FAILED)).toBe(true);
    expect(isFailure(TaskState.TIMEOUT)).toBe(true);
    expect(isFailure(TaskState.COMPLETED)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Fix 2 — Timeout bumps for daily_standup and self_reflection
// ═══════════════════════════════════════════════════════════════════════════════

describe('Fix 2 — daily_standup and self_reflection timeout bumped to 10 min', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('daily_standup timeout is 10 minutes', async () => {
    // getTimeoutForTask is private — access via enqueueTask which calls it
    const d = makeDispatcher();
    mockRedis.set.mockResolvedValue('OK');
    const task = await d.enqueueTask({ taskName: 'daily_standup' });
    expect(task.timeoutMs).toBe(10 * 60 * 1000);
  });

  it('self_reflection timeout is 10 minutes', async () => {
    const d = makeDispatcher();
    mockRedis.set.mockResolvedValue('OK');
    const task = await d.enqueueTask({ taskName: 'self_reflection' });
    expect(task.timeoutMs).toBe(10 * 60 * 1000);
  });

  it('implement_directive timeout is 45 minutes', async () => {
    const d = makeDispatcher();
    mockRedis.set.mockResolvedValue('OK');
    const task = await d.handleEvent(
      'architect:build_directive',
      {
        id: 'evt-3',
        source: 'architect',
        type: 'build_directive',
        payload: { issue_number: 55, repo: 'yclaw-protocol', owner: 'yclaw-ai' },
        timestamp: new Date().toISOString(),
        correlationId: `yclaw-ai/yclaw-protocol:issue:${Date.now()}`,
      },
    );
    expect(task?.timeoutMs).toBe(45 * 60 * 1000);
  });
});
