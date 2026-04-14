import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import type { YClawEvent } from '../src/types/events.js';
import { initAgentRegistry } from '../src/notifications/AgentRegistry.js';
import { createMockAgentConfigs } from './helpers/mock-agent-configs.js';

beforeAll(() => { initAgentRegistry(createMockAgentConfigs()); });

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

const { Journaler, formatComment, JOURNALER_MARKER, MILESTONE_TYPES } =
  await import('../src/modules/journaler.js');

// ─── Mock Factories ────────────────────────────────────────────────────────

function createMockRedis() {
  const store = new Map<string, string>();
  const hashStore = new Map<string, Map<string, string>>();
  return {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    set: vi.fn(async (key: string, value: string) => { store.set(key, value); return 'OK'; }),
    hget: vi.fn(async (key: string, field: string) => hashStore.get(key)?.get(field) ?? null),
    hset: vi.fn(async (key: string, field: string, value: string) => {
      if (!hashStore.has(key)) hashStore.set(key, new Map());
      hashStore.get(key)!.set(field, value);
      return 1;
    }),
    expire: vi.fn().mockResolvedValue(1),
    // For internal access in tests
    _store: store,
    _hashStore: hashStore,
  } as any;
}

function createMockEventStream() {
  return {
    subscribeStream: vi.fn(),
    publishEvent: vi.fn().mockResolvedValue('1-0'),
    shutdown: vi.fn(),
  } as any;
}

function createMockGitHub() {
  return {
    execute: vi.fn().mockResolvedValue({
      success: true,
      data: { issueNumber: 42, url: 'https://github.com/yclaw-ai/yclaw/issues/42' },
    }),
  } as any;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeEvent(
  type: string,
  source = 'builder',
  payload: Record<string, unknown> = {},
  correlationId = 'corr-123',
): YClawEvent<unknown> {
  return {
    id: 'evt-1',
    type,
    source,
    target: null,
    correlation_id: correlationId,
    causation_id: null,
    timestamp: new Date().toISOString(),
    schema_version: 1,
    payload,
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('Journaler', () => {
  let redis: ReturnType<typeof createMockRedis>;
  let eventStream: ReturnType<typeof createMockEventStream>;
  let github: ReturnType<typeof createMockGitHub>;
  let journaler: InstanceType<typeof Journaler>;

  beforeEach(() => {
    vi.clearAllMocks();
    redis = createMockRedis();
    eventStream = createMockEventStream();
    github = createMockGitHub();
    journaler = new Journaler(redis, eventStream, github, 'TestOrg', 'test-repo');
  });

  // ─── start() ────────────────────────────────────────────────────────────

  describe('start', () => {
    it('subscribes to coord stream with journaler consumer group', async () => {
      await journaler.start();

      expect(eventStream.subscribeStream).toHaveBeenCalledWith(
        'coord',
        'journaler',
        expect.any(Function),
      );
    });
  });

  // ─── Event Filtering ──────────────────────────────────────────────────

  describe('event filtering', () => {
    it('processes milestone events', async () => {
      await journaler.start();
      const handler = eventStream.subscribeStream.mock.calls[0]![2] as (e: YClawEvent<unknown>) => Promise<void>;

      // coord.task.completed is a milestone
      const event = makeEvent('coord.task.completed', 'builder', {
        task_id: 't-1',
        description: 'Fix auth bug',
      });
      await handler(event);

      // Should have called github to create default issue + post comment
      expect(github.execute).toHaveBeenCalled();
    });

    it('ignores noise events (coord.task.requested)', async () => {
      await journaler.start();
      const handler = eventStream.subscribeStream.mock.calls[0]![2] as (e: YClawEvent<unknown>) => Promise<void>;

      await handler(makeEvent('coord.task.requested'));
      expect(github.execute).not.toHaveBeenCalled();
    });

    it('ignores noise events (coord.task.accepted)', async () => {
      await journaler.start();
      const handler = eventStream.subscribeStream.mock.calls[0]![2] as (e: YClawEvent<unknown>) => Promise<void>;

      await handler(makeEvent('coord.task.accepted'));
      expect(github.execute).not.toHaveBeenCalled();
    });

    it('ignores noise events (coord.task.started)', async () => {
      await journaler.start();
      const handler = eventStream.subscribeStream.mock.calls[0]![2] as (e: YClawEvent<unknown>) => Promise<void>;

      await handler(makeEvent('coord.task.started'));
      expect(github.execute).not.toHaveBeenCalled();
    });

    it('ignores coord.status.* events', async () => {
      await journaler.start();
      const handler = eventStream.subscribeStream.mock.calls[0]![2] as (e: YClawEvent<unknown>) => Promise<void>;

      await handler(makeEvent('coord.status.ping'));
      expect(github.execute).not.toHaveBeenCalled();
    });

    it('ignores unknown non-milestone events', async () => {
      await journaler.start();
      const handler = eventStream.subscribeStream.mock.calls[0]![2] as (e: YClawEvent<unknown>) => Promise<void>;

      await handler(makeEvent('coord.task.reassigned'));
      expect(github.execute).not.toHaveBeenCalled();
    });
  });

  // ─── Issue Resolution ───────────────────────────────────────────────────

  describe('issue resolution', () => {
    it('creates a project issue on coord.project.kicked_off', async () => {
      await journaler.start();
      const handler = eventStream.subscribeStream.mock.calls[0]![2] as (e: YClawEvent<unknown>) => Promise<void>;

      const event = makeEvent('coord.project.kicked_off', 'strategist', {
        project_id: 'proj-1',
        summary: 'Deploy Governance v2',
        phase: 'planning',
        agents: ['builder', 'architect'],
      });
      await handler(event);

      // First call: create_issue for the project
      expect(github.execute).toHaveBeenCalledWith('github:create_issue', expect.objectContaining({
        owner: 'TestOrg',
        repo: 'test-repo',
        title: '[Project] Deploy Governance v2',
        labels: ['coordination'],
      }));

      // Should store mapping in Redis
      expect(redis.hset).toHaveBeenCalledWith(
        'journaler:project_issues',
        'corr-123',
        expect.stringContaining('"issue_number":42'),
      );
    });

    it('reuses existing issue for same correlation_id', async () => {
      // Pre-populate Redis mapping
      redis._hashStore.set('journaler:project_issues', new Map([
        ['corr-123', JSON.stringify({ repo: 'test-repo', issue_number: 99 })],
      ]));

      await journaler.start();
      const handler = eventStream.subscribeStream.mock.calls[0]![2] as (e: YClawEvent<unknown>) => Promise<void>;

      const event = makeEvent('coord.task.completed', 'builder', {
        task_id: 't-1',
        description: 'Done',
      });
      await handler(event);

      // Should post comment on issue #99, not create a new issue
      const commentCall = github.execute.mock.calls.find(
        (c: unknown[]) => c[0] === 'github:pr_comment',
      );
      expect(commentCall).toBeDefined();
      expect(commentCall![1]).toEqual(expect.objectContaining({
        pullNumber: 99,
      }));
    });

    it('creates default coordination issue when no mapping exists', async () => {
      await journaler.start();
      const handler = eventStream.subscribeStream.mock.calls[0]![2] as (e: YClawEvent<unknown>) => Promise<void>;

      const event = makeEvent('coord.task.completed', 'builder', {
        task_id: 't-1',
      }, 'unknown-corr');
      await handler(event);

      // First call creates the default issue
      expect(github.execute).toHaveBeenCalledWith('github:create_issue', expect.objectContaining({
        title: '[Coordination] Event Log',
        labels: ['coordination'],
      }));

      // Stores it in Redis
      expect(redis.set).toHaveBeenCalledWith('journaler:default_issue', '42');
    });

    it('reuses cached default issue on subsequent calls', async () => {
      redis._store.set('journaler:default_issue', '55');

      await journaler.start();
      const handler = eventStream.subscribeStream.mock.calls[0]![2] as (e: YClawEvent<unknown>) => Promise<void>;

      await handler(makeEvent('coord.task.completed', 'builder', {}, 'no-mapping'));

      // Let the async queue drain (processQueue is fire-and-forget)
      await new Promise(r => setTimeout(r, 50));

      // Should NOT create a new issue — reuses #55
      const createCalls = github.execute.mock.calls.filter(
        (c: unknown[]) => c[0] === 'github:create_issue',
      );
      expect(createCalls.length).toBe(0);

      // First comment should target issue #55
      const commentCalls = github.execute.mock.calls.filter(
        (c: unknown[]) => c[0] === 'github:pr_comment',
      );
      expect(commentCalls.length).toBe(1);
      expect(commentCalls[0]![1]).toEqual(expect.objectContaining({ pullNumber: 55 }));
    });
  });

  // ─── Error Handling ─────────────────────────────────────────────────────

  describe('error handling', () => {
    it('does not crash when GitHub API fails to create issue', async () => {
      github.execute.mockResolvedValue({ success: false, error: 'API rate limited' });

      await journaler.start();
      const handler = eventStream.subscribeStream.mock.calls[0]![2] as (e: YClawEvent<unknown>) => Promise<void>;

      // Should not throw
      await expect(
        handler(makeEvent('coord.task.completed', 'builder', { task_id: 't-1' }, 'no-mapping')),
      ).resolves.not.toThrow();
    });

    it('does not crash when GitHub API fails to post comment', async () => {
      // First call succeeds (create default issue), second fails (post comment)
      github.execute
        .mockResolvedValueOnce({ success: true, data: { issueNumber: 42 } })
        .mockRejectedValueOnce(new Error('Network error'));

      await journaler.start();
      const handler = eventStream.subscribeStream.mock.calls[0]![2] as (e: YClawEvent<unknown>) => Promise<void>;

      await expect(
        handler(makeEvent('coord.task.completed', 'builder', {}, 'no-mapping')),
      ).resolves.not.toThrow();
    });
  });
});

// ─── formatComment (pure function) ──────────────────────────────────────────

describe('formatComment', () => {
  it('includes the journaler marker for loop prevention', () => {
    const event = makeEvent('coord.task.completed', 'builder', { task_id: 't-1' });
    const result = formatComment(event);
    expect(result).toContain(JOURNALER_MARKER);
  });

  it('uses the correct agent emoji', () => {
    const event = makeEvent('coord.task.completed', 'architect', {});
    const result = formatComment(event);
    expect(result).toContain('**[Architect]**');
  });

  it('falls back to bell emoji for unknown agents', () => {
    const event = makeEvent('coord.task.completed', 'unknown_agent', {});
    const result = formatComment(event);
    expect(result).toContain('\u{1F514}'); // 🔔
    expect(result).toContain('**[Unknown_agent]**');
  });

  it('includes artifact link when present', () => {
    const event = makeEvent('coord.deliverable.submitted', 'builder', {
      artifact_url: 'https://github.com/PR/42',
      artifact_type: 'pr',
    });
    const result = formatComment(event);
    expect(result).toContain('[link](https://github.com/PR/42)');
  });

  it('includes correlation and task IDs', () => {
    const event = makeEvent('coord.task.completed', 'builder', { task_id: 't-99' }, 'corr-456');
    const result = formatComment(event);
    expect(result).toContain('`corr-456`');
    expect(result).toContain('`t-99`');
  });

  it('adds "Needs" line for blocked events', () => {
    const event = makeEvent('coord.task.blocked', 'builder', {
      message: 'Waiting for Architect review',
    });
    const result = formatComment(event);
    expect(result).toContain('**Needs:** Waiting for Architect review');
  });

  it('quotes feedback for review events', () => {
    const event = makeEvent('coord.review.completed', 'architect', {
      task_id: 't-1',
      reviewer: 'architect',
      status: 'changes_requested',
      feedback: 'Please add error handling',
    });
    const result = formatComment(event);
    expect(result).toContain('> Please add error handling');
  });

  it('describes deliverable submission correctly', () => {
    const event = makeEvent('coord.deliverable.submitted', 'builder', {
      artifact_type: 'pr',
      description: 'Auth refactor',
    });
    const result = formatComment(event);
    expect(result).toContain('submitted deliverable');
  });

  it('describes project kickoff correctly', () => {
    const event = makeEvent('coord.project.kicked_off', 'strategist', {
      project_id: 'proj-1',
    });
    const result = formatComment(event);
    expect(result).toContain('kicked off project');
  });

  it('describes phase completion correctly', () => {
    const event = makeEvent('coord.project.phase_completed', 'strategist', {
      project_id: 'proj-1',
      phase: 'implementation',
    });
    const result = formatComment(event);
    expect(result).toContain('completed phase');
    expect(result).toContain('implementation');
  });

  it('describes task failure with message', () => {
    const event = makeEvent('coord.task.failed', 'builder', {
      task_id: 't-1',
      message: 'OOM killed',
    });
    const result = formatComment(event);
    expect(result).toContain('task failed');
    expect(result).toContain('OOM killed');
  });
});

// ─── MILESTONE_TYPES ────────────────────────────────────────────────────────

describe('MILESTONE_TYPES', () => {
  it('includes all expected milestone types', () => {
    const expected = [
      'coord.deliverable.submitted',
      'coord.deliverable.approved',
      'coord.deliverable.changes_requested',
      'coord.review.completed',
      'coord.task.blocked',
      'coord.task.completed',
      'coord.task.failed',
      'coord.project.kicked_off',
      'coord.project.phase_completed',
      'coord.project.completed',
    ];
    for (const type of expected) {
      expect(MILESTONE_TYPES.has(type)).toBe(true);
    }
  });

  it('does not include noise types', () => {
    expect(MILESTONE_TYPES.has('coord.task.requested')).toBe(false);
    expect(MILESTONE_TYPES.has('coord.task.accepted')).toBe(false);
    expect(MILESTONE_TYPES.has('coord.task.started')).toBe(false);
  });
});
