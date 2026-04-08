import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { YClawEvent } from '../src/types/events.js';
import type { IChannel } from '../src/interfaces/IChannel.js';

vi.mock('../src/logging/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

const { ChannelNotifier } = await import('../src/modules/channel-notifier.js');

// ─── Mock factories ─────────────────────────────────────────────────────────

function createMockRedis() {
  const store = new Map<string, string>();
  return {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    set: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
      return 'OK';
    }),
    _store: store,
  } as any;
}

function createMockEventStream() {
  return {
    subscribeStream: vi.fn(),
  } as any;
}

function createMockChannel(
  name: string,
  overrides: Partial<IChannel> = {},
): IChannel & { send: ReturnType<typeof vi.fn> } {
  const send = vi.fn(async () => ({
    success: true,
    messageId: `msg-${name}-${Math.random().toString(36).slice(2, 8)}`,
  }));
  return {
    name,
    connect: vi.fn(),
    disconnect: vi.fn(),
    healthy: vi.fn(async () => true),
    send,
    listen: vi.fn(),
    supportsInboundListening: () => false,
    supportsReactions: () => false,
    supportsThreads: () => true,
    supportsFileUpload: () => false,
    supportsIdentityOverride: () => false,
    ...overrides,
  } as any;
}

function makeEvent(
  type: string,
  source = 'builder',
  payload: Record<string, unknown> = {},
  correlationId = 'corr-abc',
): YClawEvent<unknown> {
  return {
    id: 'evt-' + Math.random().toString(36).slice(2, 8),
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

// ─── Env snapshot ───────────────────────────────────────────────────────────

const TRACKED_ENV_KEYS = [
  'DISCORD_CHANNEL_DEVELOPMENT',
  'DISCORD_CHANNEL_EXECUTIVE',
  'DISCORD_CHANNEL_GENERAL',
  'DISCORD_CHANNEL_ALERTS',
  'SLACK_CHANNEL_DEVELOPMENT',
  'SLACK_CHANNEL_ALERTS',
];

function snapshotEnv(): Record<string, string | undefined> {
  const snap: Record<string, string | undefined> = {};
  for (const k of TRACKED_ENV_KEYS) snap[k] = process.env[k];
  return snap;
}

function restoreEnv(snap: Record<string, string | undefined>): void {
  for (const [k, v] of Object.entries(snap)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('ChannelNotifier', () => {
  let envSnap: Record<string, string | undefined>;
  let redis: ReturnType<typeof createMockRedis>;
  let eventStream: ReturnType<typeof createMockEventStream>;

  beforeEach(() => {
    vi.clearAllMocks();
    envSnap = snapshotEnv();
    for (const k of TRACKED_ENV_KEYS) delete process.env[k];
    redis = createMockRedis();
    eventStream = createMockEventStream();
  });

  afterEach(() => {
    restoreEnv(envSnap);
  });

  async function startAndGetHandler(channels: Map<string, IChannel>) {
    const notifier = new ChannelNotifier(redis, eventStream, channels);
    await notifier.start();
    if (channels.size === 0) return null;
    expect(eventStream.subscribeStream).toHaveBeenCalledWith(
      'coord',
      'channel-notifier',
      expect.any(Function),
    );
    return eventStream.subscribeStream.mock.calls[0][2] as (
      event: YClawEvent<unknown>,
    ) => Promise<void>;
  }

  it('skips subscription when no channels are configured', async () => {
    const handler = await startAndGetHandler(new Map());
    expect(handler).toBeNull();
    expect(eventStream.subscribeStream).not.toHaveBeenCalled();
  });

  it('posts a Slack message with Block Kit blocks', async () => {
    const slack = createMockChannel('slack');
    const channels = new Map<string, IChannel>([['slack', slack]]);
    const handler = await startAndGetHandler(channels);

    await handler!(makeEvent('coord.task.completed', 'builder', {
      task_id: 't-1',
      description: 'done',
    }));
    await new Promise((r) => setTimeout(r, 30));

    expect(slack.send).toHaveBeenCalledTimes(1);
    const [target, message] = slack.send.mock.calls[0];
    expect(target.channelId).toBe('#yclaw-development');
    expect(message.text).toContain('[Builder]');
    // Block Kit passthrough — opaque to the IChannel contract
    expect((message as any).blocks).toBeInstanceOf(Array);
  });

  it('fans out to both Slack and Discord when both are configured', async () => {
    process.env.DISCORD_CHANNEL_DEVELOPMENT = '1489421639274729502';

    const slack = createMockChannel('slack');
    const discord = createMockChannel('discord');
    const channels = new Map<string, IChannel>([
      ['slack', slack],
      ['discord', discord],
    ]);
    const handler = await startAndGetHandler(channels);

    await handler!(makeEvent('coord.task.completed', 'builder', {
      task_id: 't-1',
      description: 'shipped',
    }));
    await new Promise((r) => setTimeout(r, 30));

    expect(slack.send).toHaveBeenCalledTimes(1);
    expect(discord.send).toHaveBeenCalledTimes(1);

    const [slackTarget] = slack.send.mock.calls[0];
    expect(slackTarget.channelId).toBe('#yclaw-development');

    const [discordTarget, discordMsg] = discord.send.mock.calls[0];
    expect(discordTarget.channelId).toBe('1489421639274729502');
    // Discord uses plain markdown, never Block Kit
    expect((discordMsg as any).blocks).toBeUndefined();
    expect(discordMsg.text).toContain('**Builder**');
  });

  it('skips Discord when no channel is configured for the department', async () => {
    const slack = createMockChannel('slack');
    const discord = createMockChannel('discord');
    const channels = new Map<string, IChannel>([
      ['slack', slack],
      ['discord', discord],
    ]);
    const handler = await startAndGetHandler(channels);

    await handler!(makeEvent('coord.task.completed', 'builder'));
    await new Promise((r) => setTimeout(r, 30));

    expect(slack.send).toHaveBeenCalledTimes(1);
    expect(discord.send).not.toHaveBeenCalled();
  });

  it('falls back to DISCORD_CHANNEL_GENERAL for unknown departments', async () => {
    process.env.DISCORD_CHANNEL_GENERAL = '1489421589941325904';
    const discord = createMockChannel('discord');
    const channels = new Map<string, IChannel>([['discord', discord]]);
    const handler = await startAndGetHandler(channels);

    await handler!(makeEvent('coord.task.completed', 'mystery-agent'));
    await new Promise((r) => setTimeout(r, 30));

    expect(discord.send).toHaveBeenCalledTimes(1);
    const [target] = discord.send.mock.calls[0];
    expect(target.channelId).toBe('1489421589941325904');
  });

  it('threads Slack posts by correlation_id but leaves Discord flat', async () => {
    process.env.DISCORD_CHANNEL_DEVELOPMENT = '1489421639274729502';

    const slack = createMockChannel('slack');
    // First Slack send returns a message ID we can match against later.
    slack.send
      .mockResolvedValueOnce({ success: true, messageId: '1111111111.111111' })
      .mockResolvedValueOnce({ success: true, messageId: '2222222222.222222' });

    const discord = createMockChannel('discord');
    const channels = new Map<string, IChannel>([
      ['slack', slack],
      ['discord', discord],
    ]);
    const handler = await startAndGetHandler(channels);

    const first = makeEvent('coord.task.started', 'builder', { task_id: 't-1' }, 'proj-42');
    const second = makeEvent('coord.task.completed', 'builder', { task_id: 't-1', description: 'done' }, 'proj-42');

    await handler!(first);
    await new Promise((r) => setTimeout(r, 30));
    await handler!(second);
    // Rate limit is 1s per channel; give the second post time to clear.
    await new Promise((r) => setTimeout(r, 1100));

    // Slack: first call has no threadId, second call does
    expect(slack.send).toHaveBeenCalledTimes(2);
    const firstSlack = slack.send.mock.calls[0];
    const secondSlack = slack.send.mock.calls[1];
    expect(firstSlack[0].threadId).toBeUndefined();
    expect(secondSlack[0].threadId).toBe('1111111111.111111');

    // Discord never gets a threadId — both calls top-level
    expect(discord.send).toHaveBeenCalledTimes(2);
    expect(discord.send.mock.calls[0][0].threadId).toBeUndefined();
    expect(discord.send.mock.calls[1][0].threadId).toBeUndefined();
  });

  it('double-posts escalations to the alerts channel as a new top-level message', async () => {
    process.env.DISCORD_CHANNEL_DEVELOPMENT = 'discord-dev';
    process.env.DISCORD_CHANNEL_ALERTS = 'discord-alerts';

    const slack = createMockChannel('slack');
    const discord = createMockChannel('discord');
    const channels = new Map<string, IChannel>([
      ['slack', slack],
      ['discord', discord],
    ]);
    const handler = await startAndGetHandler(channels);

    await handler!(makeEvent('coord.task.blocked', 'builder', {
      task_id: 't-1',
      message: 'Need API key',
    }));
    await new Promise((r) => setTimeout(r, 50));

    const slackChannels = slack.send.mock.calls.map((c: any) => c[0].channelId);
    expect(slackChannels).toContain('#yclaw-development');
    expect(slackChannels).toContain('#yclaw-alerts');

    const discordChannels = discord.send.mock.calls.map((c: any) => c[0].channelId);
    expect(discordChannels).toContain('discord-dev');
    expect(discordChannels).toContain('discord-alerts');
  });

  it('skips coord.status.* heartbeat events', async () => {
    const slack = createMockChannel('slack');
    const channels = new Map<string, IChannel>([['slack', slack]]);
    const handler = await startAndGetHandler(channels);

    await handler!(makeEvent('coord.status.heartbeat', 'system'));
    await new Promise((r) => setTimeout(r, 30));

    expect(slack.send).not.toHaveBeenCalled();
  });
});
