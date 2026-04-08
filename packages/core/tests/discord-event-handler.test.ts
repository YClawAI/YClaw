import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InboundMessage, InboundMessageHandler } from '../src/interfaces/IChannel.js';

vi.mock('../src/logging/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

const { DiscordEventHandler } = await import('../src/triggers/discord-event-handler.js');

// ─── Fixtures ──────────────────────────────────────────────────────────────

function createMockEventBus() {
  return {
    publish: vi.fn(async () => undefined),
  } as any;
}

function createMockAdapter() {
  let capturedHandler: InboundMessageHandler | null = null;
  return {
    name: 'discord',
    listen: vi.fn(async (handler: InboundMessageHandler) => {
      capturedHandler = handler;
    }),
    getCapturedHandler: (): InboundMessageHandler | null => capturedHandler,
    send: vi.fn(),
    healthy: vi.fn(async () => true),
    connect: vi.fn(),
    disconnect: vi.fn(),
  } as any;
}

const BOT_USER_ID = 'bot-user-9999';
const ALICE_USER_ID = 'user-alice';
const PARENT_CHANNEL_ID = '1489421589941325904';
const OTHER_CHANNEL_ID = '1489421500000000000';
const THREAD_CHANNEL_ID = '1489421599999999999';

function baseRaw(overrides: Record<string, unknown> = {}) {
  return {
    author: { id: ALICE_USER_ID, username: 'alice', bot: false },
    guildId: 'guild-1',
    channel: { parentId: null, isThread: () => false },
    mentions: {
      users: { has: (_id: string) => false, size: 0 },
    },
    client: { user: { id: BOT_USER_ID } },
    ...overrides,
  };
}

function makeInbound(overrides: Partial<InboundMessage> = {}, raw?: Record<string, unknown>): InboundMessage {
  return {
    messageId: 'msg-' + Math.random().toString(36).slice(2, 8),
    channelId: PARENT_CHANNEL_ID,
    userId: ALICE_USER_ID,
    displayName: 'alice',
    text: 'hello world',
    threadId: undefined,
    timestamp: new Date().toISOString(),
    raw: raw ?? baseRaw(),
    ...overrides,
  };
}

// ─── Env snapshot ──────────────────────────────────────────────────────────

function snapshotEnv(keys: string[]): Record<string, string | undefined> {
  const s: Record<string, string | undefined> = {};
  for (const k of keys) s[k] = process.env[k];
  return s;
}
function restoreEnv(snap: Record<string, string | undefined>): void {
  for (const [k, v] of Object.entries(snap)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('DiscordEventHandler', () => {
  let eventBus: ReturnType<typeof createMockEventBus>;
  let adapter: ReturnType<typeof createMockAdapter>;
  let handler: InstanceType<typeof DiscordEventHandler>;
  let envSnap: Record<string, string | undefined>;

  beforeEach(() => {
    vi.clearAllMocks();
    envSnap = snapshotEnv(['DISCORD_ALLOWED_CHANNEL_IDS']);
    delete process.env.DISCORD_ALLOWED_CHANNEL_IDS;
    eventBus = createMockEventBus();
    adapter = createMockAdapter();
  });

  afterEach(() => {
    restoreEnv(envSnap);
  });

  async function startAndGet(): Promise<InboundMessageHandler> {
    handler = new DiscordEventHandler(eventBus, adapter);
    await handler.start();
    expect(adapter.listen).toHaveBeenCalledTimes(1);
    const fn = adapter.getCapturedHandler();
    if (!fn) throw new Error('handler not registered');
    return fn;
  }

  // ─── Basic routing ──────────────────────────────────────────────────

  it('publishes discord:message for a normal message', async () => {
    const inbound = makeInbound({ text: 'good morning' });
    const fn = await startAndGet();
    await fn(inbound);

    expect(eventBus.publish).toHaveBeenCalledTimes(1);
    const [source, type, payload] = eventBus.publish.mock.calls[0];
    expect(source).toBe('discord');
    expect(type).toBe('message');
    expect(payload.text).toBe('good morning');
    expect(payload.isMention).toBe(false);
    expect(payload.isThread).toBe(false);
  });

  it('publishes discord:mention when the bot user is mentioned', async () => {
    const raw = baseRaw({
      mentions: { users: { has: (id: string) => id === BOT_USER_ID, size: 1 } },
    });
    const fn = await startAndGet();
    await fn(makeInbound({ text: '@bot help' }, raw));

    const [source, type, payload] = eventBus.publish.mock.calls[0];
    expect(source).toBe('discord');
    expect(type).toBe('mention');
    expect(payload.isMention).toBe(true);
  });

  // ─── Bot filtering ──────────────────────────────────────────────────

  it('drops bot messages (defense in depth)', async () => {
    const raw = baseRaw({ author: { id: 'bot-99', username: 'otherbot', bot: true } });
    const fn = await startAndGet();
    await fn(makeInbound({}, raw));
    expect(eventBus.publish).not.toHaveBeenCalled();
  });

  // ─── Dedup ──────────────────────────────────────────────────────────

  it('drops duplicate message IDs', async () => {
    const fn = await startAndGet();
    const dup = makeInbound({ messageId: 'same-id' });
    await fn(dup);
    await fn(dup);
    expect(eventBus.publish).toHaveBeenCalledTimes(1);
  });

  // ─── Channel allowlist ─────────────────────────────────────────────

  it('allowlist unset → all channels allowed', async () => {
    const fn = await startAndGet();
    await fn(makeInbound({ channelId: OTHER_CHANNEL_ID }));
    expect(eventBus.publish).toHaveBeenCalledTimes(1);
  });

  it('allowlist set → blocks non-allowed channels', async () => {
    process.env.DISCORD_ALLOWED_CHANNEL_IDS = PARENT_CHANNEL_ID;
    const fn = await startAndGet();
    await fn(makeInbound({ channelId: OTHER_CHANNEL_ID }));
    expect(eventBus.publish).not.toHaveBeenCalled();
  });

  it('allowlist set → permits allowed channels', async () => {
    process.env.DISCORD_ALLOWED_CHANNEL_IDS = PARENT_CHANNEL_ID;
    const fn = await startAndGet();
    await fn(makeInbound({ channelId: PARENT_CHANNEL_ID }));
    expect(eventBus.publish).toHaveBeenCalledTimes(1);
  });

  it('thread messages check allowlist against parent channel ID', async () => {
    process.env.DISCORD_ALLOWED_CHANNEL_IDS = PARENT_CHANNEL_ID;
    const raw = baseRaw({ channel: { parentId: PARENT_CHANNEL_ID, isThread: () => true } });
    const fn = await startAndGet();
    await fn(
      makeInbound(
        { channelId: THREAD_CHANNEL_ID, threadId: THREAD_CHANNEL_ID },
        raw,
      ),
    );
    // Should be ALLOWED because parent is in the allowlist, even though the
    // thread channel ID itself isn't.
    expect(eventBus.publish).toHaveBeenCalledTimes(1);
    const [, , payload] = eventBus.publish.mock.calls[0];
    expect(payload.isThread).toBe(true);
    expect(payload.threadId).toBe(THREAD_CHANNEL_ID);
    expect(payload.parentChannelId).toBe(PARENT_CHANNEL_ID);
  });

  // ─── Secret redaction ───────────────────────────────────────────────

  it('redacts OpenAI-style keys', async () => {
    const fn = await startAndGet();
    await fn(makeInbound({ text: 'here is my key sk-abcdef1234567890abcdef1234567890' }));
    const [, , payload] = eventBus.publish.mock.calls[0];
    expect(payload.text).toContain('[REDACTED]');
    expect(payload.text).not.toContain('sk-abcdef');
  });

  it('redacts GitHub PAT tokens', async () => {
    const fn = await startAndGet();
    await fn(makeInbound({ text: 'token: ghp_abcdefghijklmnopqrstuvwxyz0123456789' }));
    const [, , payload] = eventBus.publish.mock.calls[0];
    expect(payload.text).toContain('[REDACTED]');
    expect(payload.text).not.toContain('ghp_abc');
  });

  it('redacts AWS access keys', async () => {
    const fn = await startAndGet();
    await fn(makeInbound({ text: 'creds: AKIAIOSFODNN7EXAMPLE done' }));
    const [, , payload] = eventBus.publish.mock.calls[0];
    expect(payload.text).toContain('[REDACTED]');
    expect(payload.text).not.toContain('AKIAIOSFODNN7EXAMPLE');
  });

  it('does not mangle normal chat text', async () => {
    const fn = await startAndGet();
    await fn(makeInbound({ text: 'This is a perfectly normal sentence about the weather today.' }));
    const [, , payload] = eventBus.publish.mock.calls[0];
    expect(payload.text).toBe('This is a perfectly normal sentence about the weather today.');
  });

  // ─── Robustness ─────────────────────────────────────────────────────

  it('handles missing or partial raw payload without crashing', async () => {
    const fn = await startAndGet();
    await expect(fn(makeInbound({ raw: undefined }))).resolves.not.toThrow();
    expect(eventBus.publish).toHaveBeenCalledTimes(1);
  });

  // ─── Payload shape ──────────────────────────────────────────────────

  it('emits the expected payload shape', async () => {
    const fn = await startAndGet();
    await fn(
      makeInbound({
        messageId: 'msg-shape',
        channelId: PARENT_CHANNEL_ID,
        userId: ALICE_USER_ID,
        displayName: 'alice',
        text: 'shape test',
        timestamp: '2026-04-08T12:00:00.000Z',
      }),
    );
    const [, , payload] = eventBus.publish.mock.calls[0];
    expect(payload).toMatchObject({
      channelId: PARENT_CHANNEL_ID,
      threadId: null,
      parentChannelId: null,
      isThread: false,
      user: 'alice',
      userId: ALICE_USER_ID,
      text: 'shape test',
      messageId: 'msg-shape',
      isMention: false,
      guildId: 'guild-1',
      timestamp: '2026-04-08T12:00:00.000Z',
    });
  });

  // ─── start() wiring ─────────────────────────────────────────────────

  it('start() registers the listener on the adapter', async () => {
    handler = new DiscordEventHandler(eventBus, adapter);
    await handler.start();
    expect(adapter.listen).toHaveBeenCalledTimes(1);
    expect(adapter.getCapturedHandler()).not.toBeNull();
  });
});
