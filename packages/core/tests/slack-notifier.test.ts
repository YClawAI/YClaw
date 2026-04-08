import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { YClawEvent } from '../src/types/events.js';

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

const { SlackNotifier } = await import('../src/modules/slack-notifier.js');
const {
  buildCoordBlock,
  getChannelForAgent,
  getAgentEmoji,
  isEscalation,
  ALERTS_CHANNEL,
} = await import('../src/utils/slack-blocks.js');

// ─── Mock Factories ────────────────────────────────────────────────────────

function createMockRedis() {
  const store = new Map<string, string>();
  return {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    set: vi.fn(async (key: string, value: string) => { store.set(key, value); return 'OK'; }),
    _store: store,
  } as any;
}

function createMockEventStream() {
  return {
    subscribeStream: vi.fn(),
    publishEvent: vi.fn().mockResolvedValue('1-0'),
    shutdown: vi.fn(),
  } as any;
}

function createMockSlack() {
  return {
    execute: vi.fn().mockResolvedValue({
      success: true,
      data: { ts: '1234567890.123456', channel: 'C0000000002' },
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

// ─── slack-blocks.ts Tests ──────────────────────────────────────────────────

describe('slack-blocks', () => {
  describe('getAgentEmoji', () => {
    it('returns correct emoji for known agents', () => {
      expect(getAgentEmoji('builder')).toBe('\u{1F6E0}\uFE0F');    // 🛠️
      expect(getAgentEmoji('strategist')).toBe('\u{1F9E0}');         // 🧠
      expect(getAgentEmoji('architect')).toBe('\u{1F4D0}');          // 📐
      expect(getAgentEmoji('deployer')).toBe('\u{1F680}');           // 🚀
      expect(getAgentEmoji('signal')).toBe('\u{1F4E1}');             // 📡
    });

    it('returns bell emoji for unknown agents', () => {
      expect(getAgentEmoji('unknown-agent')).toBe('\u{1F514}');      // 🔔
    });
  });

  describe('getChannelForAgent', () => {
    it('routes development agents to #yclaw-development', () => {
      expect(getChannelForAgent('builder')).toBe('#yclaw-development');
      expect(getChannelForAgent('architect')).toBe('#yclaw-development');
      expect(getChannelForAgent('deployer')).toBe('#yclaw-development');
      expect(getChannelForAgent('designer')).toBe('#yclaw-development');
    });

    it('routes executive agents to #yclaw-executive', () => {
      expect(getChannelForAgent('strategist')).toBe('#yclaw-executive');
      expect(getChannelForAgent('reviewer')).toBe('#yclaw-executive');
    });

    it('routes marketing agents to #yclaw-marketing', () => {
      expect(getChannelForAgent('ember')).toBe('#yclaw-marketing');
      expect(getChannelForAgent('forge')).toBe('#yclaw-marketing');
      expect(getChannelForAgent('scout')).toBe('#yclaw-marketing');
    });

    it('routes operations agents to #yclaw-operations', () => {
      expect(getChannelForAgent('sentinel')).toBe('#yclaw-operations');
      expect(getChannelForAgent('signal')).toBe('#yclaw-operations');
    });

    it('routes finance agents to #yclaw-finance', () => {
      expect(getChannelForAgent('treasurer')).toBe('#yclaw-finance');
    });

    it('routes support agents to #yclaw-support', () => {
      expect(getChannelForAgent('guide')).toBe('#yclaw-support');
      expect(getChannelForAgent('keeper')).toBe('#yclaw-support');
    });

    it('returns fallback channel for unknown agents', () => {
      expect(getChannelForAgent('unknown')).toBe('#yclaw-general');
    });
  });

  describe('buildCoordBlock', () => {
    it('builds section block with agent emoji and action', () => {
      const event = makeEvent('coord.task.completed', 'builder', {
        task_id: 't-1', description: 'Implemented feature X',
      });
      const blocks = buildCoordBlock(event);

      expect(blocks.length).toBeGreaterThanOrEqual(1);
      expect(blocks[0]!.type).toBe('section');
      const text = blocks[0]!.text!.text;
      expect(text).toContain('[Builder]');
      expect(text).toContain('completed task');
      expect(text).toContain('Implemented feature X');
    });

    it('includes artifact link when present', () => {
      const event = makeEvent('coord.deliverable.submitted', 'builder', {
        task_id: 't-1',
        artifact_url: 'https://github.com/yclaw-ai/yclaw/pull/42',
        artifact_type: 'pr',
      });
      const blocks = buildCoordBlock(event);
      const text = blocks[0]!.text!.text;
      expect(text).toContain('<https://github.com/yclaw-ai/yclaw/pull/42|View>');
    });

    it('includes context block with correlation and task IDs', () => {
      const event = makeEvent('coord.task.completed', 'builder', {
        task_id: 't-1',
      }, 'proj-1');
      const blocks = buildCoordBlock(event);
      const contextBlock = blocks.find(b => b.type === 'context');
      expect(contextBlock).toBeDefined();
      expect(contextBlock!.elements![0]!.text).toContain('proj-1');
      expect(contextBlock!.elements![0]!.text).toContain('t-1');
    });

    it('includes target agent when specified', () => {
      const event = { ...makeEvent('coord.task.requested', 'strategist', {
        task_id: 't-1', description: 'Build something',
      }), target: 'builder' };
      const blocks = buildCoordBlock(event);
      const text = blocks[0]!.text!.text;
      expect(text).toContain('[Builder]');
    });

    it('shows blocked needs for blocked events', () => {
      const event = makeEvent('coord.task.blocked', 'builder', {
        task_id: 't-1', message: 'Need API credentials',
      });
      const blocks = buildCoordBlock(event);
      const text = blocks[0]!.text!.text;
      expect(text).toContain('Need API credentials');
    });

    it('quotes review feedback', () => {
      const event = makeEvent('coord.review.completed', 'architect', {
        task_id: 't-1', reviewer: 'architect', status: 'changes_requested',
        feedback: 'Add tests for edge case',
      });
      const blocks = buildCoordBlock(event);
      const text = blocks[0]!.text!.text;
      expect(text).toContain('> Add tests for edge case');
    });
  });

  describe('isEscalation', () => {
    it('returns true for blocked events', () => {
      expect(isEscalation(makeEvent('coord.task.blocked'))).toBe(true);
    });

    it('returns true for failed events', () => {
      expect(isEscalation(makeEvent('coord.task.failed'))).toBe(true);
    });

    it('returns true for project completed', () => {
      expect(isEscalation(makeEvent('coord.project.completed'))).toBe(true);
    });

    it('returns false for regular milestone events', () => {
      expect(isEscalation(makeEvent('coord.task.completed'))).toBe(false);
      expect(isEscalation(makeEvent('coord.deliverable.submitted'))).toBe(false);
      expect(isEscalation(makeEvent('coord.review.completed'))).toBe(false);
    });
  });

  describe('ALERTS_CHANNEL', () => {
    it('resolves to the #yclaw-alerts channel by default', () => {
      expect(ALERTS_CHANNEL).toBe('#yclaw-alerts');
    });
  });
});

// ─── SlackNotifier Tests ────────────────────────────────────────────────────

describe('SlackNotifier', () => {
  let redis: ReturnType<typeof createMockRedis>;
  let eventStream: ReturnType<typeof createMockEventStream>;
  let slack: ReturnType<typeof createMockSlack>;
  let notifier: InstanceType<typeof SlackNotifier>;
  let handler: (event: YClawEvent<unknown>) => Promise<void>;

  beforeEach(() => {
    vi.clearAllMocks();
    redis = createMockRedis();
    eventStream = createMockEventStream();
    slack = createMockSlack();
    notifier = new SlackNotifier(redis, eventStream, slack);
  });

  async function startAndGetHandler() {
    await notifier.start();
    expect(eventStream.subscribeStream).toHaveBeenCalledWith(
      'coord', 'slack-notifier', expect.any(Function),
    );
    handler = eventStream.subscribeStream.mock.calls[0][2];
    return handler;
  }

  it('subscribes to coord stream with group slack-notifier', async () => {
    await startAndGetHandler();
    expect(eventStream.subscribeStream).toHaveBeenCalledTimes(1);
  });

  it('posts Block Kit message to correct department channel', async () => {
    await startAndGetHandler();
    const event = makeEvent('coord.task.completed', 'builder', {
      task_id: 't-1', description: 'done',
    });

    await handler(event);
    // Allow queue to drain
    await new Promise(r => setTimeout(r, 50));

    expect(slack.execute).toHaveBeenCalledWith('message', expect.objectContaining({
      channel: '#yclaw-development', // builder's department
      blocks: expect.any(Array),
    }));
  });

  it('skips coord.status.* events silently', async () => {
    await startAndGetHandler();
    await handler(makeEvent('coord.status.heartbeat', 'system'));
    await new Promise(r => setTimeout(r, 50));
    expect(slack.execute).not.toHaveBeenCalled();
  });

  it('saves thread_ts from first message for correlation_id', async () => {
    await startAndGetHandler();
    const event = makeEvent('coord.task.completed', 'builder', {
      task_id: 't-1',
    }, 'proj-1');

    await handler(event);
    await new Promise(r => setTimeout(r, 50));

    expect(redis.set).toHaveBeenCalledWith(
      'slack:thread:proj-1',
      '1234567890.123456',
      'EX',
      604800, // 7 days in seconds
    );
  });

  it('replies in thread for subsequent events with same correlation_id', async () => {
    await startAndGetHandler();

    // Seed the thread_ts in Redis
    redis._store.set('slack:thread:proj-1', '1111111111.111111');

    const event = makeEvent('coord.deliverable.submitted', 'builder', {
      task_id: 't-1', artifact_type: 'pr',
      artifact_url: 'https://github.com/example/pr/1',
    }, 'proj-1');

    await handler(event);
    await new Promise(r => setTimeout(r, 50));

    expect(slack.execute).toHaveBeenCalledWith('thread_reply', expect.objectContaining({
      channel: '#yclaw-development',
      threadTs: '1111111111.111111',
    }));
  });

  it('posts escalation events to both department channel and #yclaw-alerts', async () => {
    await startAndGetHandler();
    const event = makeEvent('coord.task.blocked', 'builder', {
      task_id: 't-1', message: 'Need API key',
    });

    await handler(event);
    // Allow queue to drain (2 posts: department + alerts)
    await new Promise(r => setTimeout(r, 100));

    const calls = slack.execute.mock.calls;
    const channels = calls.map((c: unknown[]) => (c[1] as Record<string, unknown>).channel);
    expect(channels).toContain('#yclaw-development');
    expect(channels).toContain('#yclaw-alerts');
  });

  it('does not double-post if department channel IS #yclaw-alerts', async () => {
    await startAndGetHandler();
    // Escalation from an unknown agent (falls back to #yclaw-general, not alerts)
    // Use a regular dev agent that won't route to alerts
    const event = makeEvent('coord.task.failed', 'architect', {
      task_id: 't-1', message: 'Build error',
    });

    await handler(event);
    await new Promise(r => setTimeout(r, 100));

    // Should have 2 calls: department channel + alerts
    expect(slack.execute).toHaveBeenCalledTimes(2);
  });

  it('falls back to new message if thread reply fails', async () => {
    await startAndGetHandler();

    // Seed thread_ts
    redis._store.set('slack:thread:proj-1', '1111111111.111111');

    // Make thread_reply fail
    slack.execute
      .mockResolvedValueOnce({ success: false, error: 'thread_not_found' })
      .mockResolvedValueOnce({
        success: true,
        data: { ts: '2222222222.222222', channel: '#yclaw-development' },
      });

    const event = makeEvent('coord.task.completed', 'builder', {
      task_id: 't-1',
    }, 'proj-1');

    await handler(event);
    await new Promise(r => setTimeout(r, 50));

    // Should try thread_reply first, then fall back to message
    expect(slack.execute).toHaveBeenCalledWith('thread_reply', expect.anything());
    expect(slack.execute).toHaveBeenCalledWith('message', expect.anything());
  });

  it('handles Slack executor errors gracefully', async () => {
    await startAndGetHandler();
    slack.execute.mockRejectedValueOnce(new Error('Slack API down'));

    const event = makeEvent('coord.task.completed', 'builder', {
      task_id: 't-1',
    });

    // Should not throw
    await handler(event);
    await new Promise(r => setTimeout(r, 50));
  });

  it('routes marketing agent events to #yclaw-marketing', async () => {
    await startAndGetHandler();
    const event = makeEvent('coord.task.completed', 'ember', {
      task_id: 't-1', description: 'Content published',
    });

    await handler(event);
    await new Promise(r => setTimeout(r, 50));

    expect(slack.execute).toHaveBeenCalledWith('message', expect.objectContaining({
      channel: '#yclaw-marketing',
    }));
  });

  it('routes unknown agents to fallback #yclaw-general', async () => {
    await startAndGetHandler();
    const event = makeEvent('coord.task.completed', 'unknown-agent', {
      task_id: 't-1',
    });

    await handler(event);
    await new Promise(r => setTimeout(r, 50));

    expect(slack.execute).toHaveBeenCalledWith('message', expect.objectContaining({
      channel: '#yclaw-general',
    }));
  });
});
