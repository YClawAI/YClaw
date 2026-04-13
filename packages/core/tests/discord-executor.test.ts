import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DiscordChannelAdapter } from '../src/adapters/channels/DiscordChannelAdapter.js';

// ─── Mocks ──────────────────────────────────────────────────────────────────

vi.mock('../src/logging/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

const { DiscordExecutor } = await import('../src/actions/discord.js');

// ─── Fixtures ──────────────────────────────────────────────────────────────

function createMockAdapter(): DiscordChannelAdapter & {
  send: ReturnType<typeof vi.fn>;
  createThread: ReturnType<typeof vi.fn>;
  react: ReturnType<typeof vi.fn>;
  fetchChannelHistory: ReturnType<typeof vi.fn>;
  fetchThreadReplies: ReturnType<typeof vi.fn>;
  healthy: ReturnType<typeof vi.fn>;
} {
  const adapter = {
    name: 'discord',
    send: vi.fn(async () => ({ success: true, messageId: 'msg-1' })),
    createThread: vi.fn(async () => ({ threadId: 'thread-1', channelId: 'chan-1' })),
    react: vi.fn(async () => undefined),
    fetchChannelHistory: vi.fn(async () => [
      { id: 'm1', author: { id: 'u1', username: 'alice', bot: false }, content: 'hi', createdAt: new Date().toISOString(), threadId: null },
    ]),
    fetchThreadReplies: vi.fn(async () => [
      { id: 'm2', author: { id: 'u2', username: 'bob', bot: false }, content: 'yo', createdAt: new Date().toISOString(), threadId: 'thread-1' },
    ]),
    healthy: vi.fn(async () => true),
    isConnected: vi.fn(() => true),
    connect: vi.fn(),
    disconnect: vi.fn(),
    listen: vi.fn(),
    supportsInboundListening: () => true,
    supportsReactions: () => true,
    supportsThreads: () => true,
    supportsFileUpload: () => true,
    supportsIdentityOverride: () => false,
  };
  return adapter as any;
}

/**
 * In-memory Redis mock exposing the subset DiscordExecutor uses:
 * - get(key)
 * - set(key, value, 'EX', ttl, 'NX')
 * - incr(key)
 * - expire(key, ttl)
 * - eval(script, numKeys, ...keysAndArgs) — the rate-limit path runs a
 *   Lua script with 2 keys (hourKey, cooldownKey) and 3 args (hourlyCap,
 *   cooldownSeconds, hourlyWindowS). Only the check-and-consume logic is
 *   simulated here; if you add new scripts, extend this mock.
 */
function createMockRedis(): {
  get: ReturnType<typeof vi.fn>;
  set: ReturnType<typeof vi.fn>;
  incr: ReturnType<typeof vi.fn>;
  expire: ReturnType<typeof vi.fn>;
  eval: ReturnType<typeof vi.fn>;
  _store: Map<string, string>;
} {
  const store = new Map<string, string>();
  const set = vi.fn(async (...args: unknown[]) => {
    const key = args[0] as string;
    const value = args[1] as string;
    const nx = args[args.length - 1] === 'NX';
    if (nx && store.has(key)) return null;
    store.set(key, value);
    return 'OK';
  });

vi.mock('../src/utils/channel-routing.js', () => ({
  getChannelForDepartment: vi.fn((dept) => {
    // Return fake snowflake IDs for test channels so resolveChannelId works
    const testChannels = {
      support: '1111111111111111111',
      general: '2222222222222222222',
      development: '3333333333333333333',
      marketing: '4444444444444444444',
      executive: '5555555555555555555',
      operations: '6666666666666666666',
      finance: '7777777777777777777',
      audit: '8888888888888888888',
      alerts: '9999999999999999999',
    };
    return testChannels[dept] || undefined;
  }),
  getChannelForAgent: vi.fn().mockReturnValue(undefined),
}));
  const get = vi.fn(async (key: string) => store.get(key) ?? null);
  const incr = vi.fn(async (key: string) => {
    const next = (parseInt(store.get(key) ?? '0', 10)) + 1;
    store.set(key, String(next));
    return next;
  });
  const expire = vi.fn(async () => 1);
  const evalFn = vi.fn(async (
    _script: string,
    _numKeys: number,
    hourKey: string,
    cooldownKey: string,
    hourlyCap: string,
    cooldownSeconds: string,
    _hourlyWindowS: string,
  ) => {
    const cap = parseInt(hourlyCap, 10);
    const count = parseInt(store.get(hourKey) ?? '0', 10);
    if (count >= cap) return 'hourly_cap';
    if (store.has(cooldownKey)) return 'cooldown';
    // Set cooldown with TTL (ignored in mock, just track presence)
    store.set(cooldownKey, '1');
    void cooldownSeconds; // kept for parity with prod signature
    // Increment hour count
    store.set(hourKey, String(count + 1));
    return 'ok';
  });
  return { get, set, incr, expire, eval: evalFn, _store: store } as any;
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('DiscordExecutor', () => {
  let adapter: ReturnType<typeof createMockAdapter>;
  let redis: ReturnType<typeof createMockRedis>;
  let executor: InstanceType<typeof DiscordExecutor>;

  beforeEach(() => {
    adapter = createMockAdapter();
    redis = createMockRedis();
    executor = new DiscordExecutor(adapter as unknown as DiscordChannelAdapter, redis as any);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ─── Tool Definitions ────────────────────────────────────────────────

  it('getToolDefinitions returns all 7 expected tool definitions', () => {
    const defs = executor.getToolDefinitions();
    const names = defs.map((d) => d.name).sort();
    expect(names).toEqual([
      'discord:alert',
      'discord:create_thread',
      'discord:get_channel_history',
      'discord:get_thread',
      'discord:message',
      'discord:react',
      'discord:thread_reply',
    ]);
  });

  it('never exposes discord:dm in the tool list', () => {
    const defs = executor.getToolDefinitions();
    expect(defs.find((d) => d.name === 'discord:dm')).toBeUndefined();
  });

  // ─── discord:message ────────────────────────────────────────────────

  it('discord:message rejects missing channel or text', async () => {
    const noChannel = await executor.execute('message', { text: 'hi' });
    expect(noChannel.success).toBe(false);
    expect(noChannel.error).toMatch(/channel/);

    const noText = await executor.execute('message', { channel: 'general' });
    expect(noText.success).toBe(false);
    expect(noText.error).toMatch(/text/);
  });

  it('discord:message rejects text over 600 characters', async () => {
    const long = 'x'.repeat(601);
    const result = await executor.execute('message', {
      channel: 'general',
      text: long,
      agentName: 'keeper',
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('600 character limit');
    expect(adapter.send).not.toHaveBeenCalled();
  });

  it('discord:message accepts symbolic department channel names via env-var routing', async () => {
    const result = await executor.execute('message', {
      channel: 'support',
      text: 'hello',
      agentName: 'system',
    });
    expect(result.success).toBe(true);
    const [target] = adapter.send.mock.calls[0];
    expect(target.channelId).toBe('1111111111111111111');
  });

  it('discord:message accepts raw snowflake IDs', async () => {
    const snowflake = '1489421589941325904';
    const result = await executor.execute('message', {
      channel: snowflake,
      text: 'hello',
      agentName: 'system',
    });
    expect(result.success).toBe(true);
    expect(adapter.send.mock.calls[0][0].channelId).toBe(snowflake);
  });

  it('discord:message falls back to general for unknown symbolic channel names', async () => {
    const result = await executor.execute('message', {
      channel: 'not-a-real-channel',
      text: 'hi',
      agentName: 'system',
    });
    // With env-var routing, unknown channels fall back to general instead of throwing
    expect(result.success).toBe(true);
  });

  it('discord:message blocks agent posts when no webhook configured', async () => {
    const result = await executor.execute('message', {
      channel: 'support',
      text: 'hello',
      agentName: 'keeper',
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/No webhook configured/);
    expect(adapter.send).not.toHaveBeenCalled();
  });

  // ─── Rate limiting ─────────────────────────────────────────────────

  it('enforces per-channel cooldown on rapid messages', async () => {
    const first = await executor.execute('message', {
      channel: '1489421589941325904',
      text: 'hello world',
      agentName: 'system',
    });
    expect(first.success).toBe(true);
    expect(first.data?.suppressed).toBeUndefined();

    const second = await executor.execute('message', {
      channel: '1489421589941325904',
      text: 'different text',
      agentName: 'system',
    });
    expect(second.success).toBe(true);
    expect(second.data?.suppressed).toBe(true);
    expect(second.data?.reason).toBe('rate_limited');
  });

  it('enforces thread cooldown on rapid thread_reply', async () => {
    const first = await executor.execute('thread_reply', {
      channel: 'support',
      threadId: '1489421600000000000',
      text: 'first reply',
      agentName: 'system',
    });
    expect(first.success).toBe(true);
    expect(first.data?.suppressed).toBeUndefined();

    const second = await executor.execute('thread_reply', {
      channel: 'support',
      threadId: '1489421600000000000',
      text: 'different reply',
      agentName: 'system',
    });
    expect(second.success).toBe(true);
    expect(second.data?.suppressed).toBe(true);
    expect(second.data?.reason).toBe('rate_limited');
  });

  it('enforces global hourly cap (20/hour/agent)', async () => {
    // Pre-seed the hourly counter at the cap
    const bucketKeyPattern = /^discord:hourly:ember:/;
    for (let i = 0; i < 20; i++) {
      // Use distinct channels so per-channel cooldown doesn't suppress
      const distinctChannel = `148942158000000000${i}`;
      await executor.execute('message', {
        channel: distinctChannel,
        text: `msg ${i}`,
        agentName: 'ember',
      });
    }
    // 21st should trip hourly cap
    const result = await executor.execute('message', {
      channel: '1489421580000000099',
      text: 'over the cap',
      agentName: 'ember',
    });
    expect(result.success).toBe(true);
    expect(result.data?.suppressed).toBe(true);
    expect(result.data?.reason).toBe('rate_limited');
    expect(result.data?.detail).toMatch(/hourly cap/);
    expect([...redis._store.keys()].some((k) => bucketKeyPattern.test(k))).toBe(true);
  });

  it('thread_reply allows long text (no 600 char limit)', async () => {
    const long = 'x'.repeat(1500);
    const result = await executor.execute('thread_reply', {
      channel: 'support',
      threadId: '1489421600000000001',
      text: long,
      agentName: 'system',
    });
    expect(result.success).toBe(true);
    expect(result.data?.suppressed).toBeUndefined();
  });

  // ─── Dedup ──────────────────────────────────────────────────────────

  it('deduplicates identical messages within the window', async () => {
    const first = await executor.execute('message', {
      channel: '1489421581111111111',
      text: 'same content',
      agentName: 'system',
    });
    expect(first.success).toBe(true);
    expect(first.data?.suppressed).toBeUndefined();

    const second = await executor.execute('message', {
      channel: '1489421581111111111',
      text: 'same content',
      agentName: 'system',
    });
    expect(second.success).toBe(true);
    expect(second.data?.suppressed).toBe(true);
    expect(second.data?.reason).toBe('duplicate_within_window');
  });

  // ─── No DM ──────────────────────────────────────────────────────────

  it('rejects user-targeted actions (no DMs)', async () => {
    const result = await executor.execute('message', {
      userId: '12345',
      text: 'secret',
      agentName: 'keeper',
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/DMs are not supported/);
  });

  it('does not expose a dm action handler', async () => {
    // Without userId we fall through to the dispatch switch — which should
    // not have a 'dm' case. With userId we hit the no-DM gate first. Both
    // paths reject, which is what we want to assert.
    const noUser = await executor.execute('dm', { channel: 'general', text: 'hi' });
    expect(noUser.success).toBe(false);
    expect(noUser.error).toMatch(/Unknown Discord action/);
  });

  // ─── Fail-open on Redis down ─────────────────────────────────────────

  it('rate limiting fails open when Redis is unavailable', async () => {
    const adapterNoRedis = createMockAdapter();
    const execNoRedis = new DiscordExecutor(adapterNoRedis as unknown as DiscordChannelAdapter, null);
    // Post 25 messages to distinct channels — should all pass since redis is null
    // Uses agentName: 'system' because no webhooks are configured in test
    for (let i = 0; i < 25; i++) {
      const res = await execNoRedis.execute('message', {
        channel: `148942158${String(i).padStart(9, '0')}`,
        text: `msg ${i}`,
        agentName: 'system',
      });
      expect(res.success).toBe(true);
      expect(res.data?.suppressed).toBeUndefined();
    }
    expect(adapterNoRedis.send).toHaveBeenCalledTimes(25);
  });

  // ─── Other actions ──────────────────────────────────────────────────

  it('discord:create_thread delegates to adapter.createThread', async () => {
    const result = await executor.execute('create_thread', {
      channel: '1489421582222222222',
      messageId: '9999999999',
      name: 'Test Thread',
    });
    expect(result.success).toBe(true);
    expect(adapter.createThread).toHaveBeenCalledWith(
      { messageId: '9999999999', channelId: '1489421582222222222' },
      'Test Thread',
    );
    expect(result.data?.threadId).toBe('thread-1');
  });

  it('discord:react delegates to adapter.react', async () => {
    const result = await executor.execute('react', {
      channel: '1489421583333333333',
      messageId: '8888888888',
      emoji: '👍',
    });
    expect(result.success).toBe(true);
    expect(adapter.react).toHaveBeenCalledWith(
      { messageId: '8888888888', channelId: '1489421583333333333' },
      '👍',
    );
  });

  it('discord:get_channel_history returns normalized messages from adapter', async () => {
    const result = await executor.execute('get_channel_history', {
      channel: 'general',
      limit: 10,
    });
    expect(result.success).toBe(true);
    expect(adapter.fetchChannelHistory).toHaveBeenCalledWith('2222222222222222222', 10);
    expect(Array.isArray(result.data?.messages)).toBe(true);
  });

  it('discord:get_thread returns normalized messages from adapter', async () => {
    const result = await executor.execute('get_thread', {
      threadId: '1489421584444444444',
      limit: 5,
    });
    expect(result.success).toBe(true);
    expect(adapter.fetchThreadReplies).toHaveBeenCalledWith('1489421584444444444', 5);
  });

  it('discord:alert posts a formatted embed-style message via bot for system caller', async () => {
    const result = await executor.execute('alert', {
      channel: '1489421585555555555',
      text: 'System is down',
      severity: 'critical',
      title: 'Outage',
      agentName: 'system',
    });
    expect(result.success).toBe(true);
    const [, msg] = adapter.send.mock.calls[0];
    expect(msg.text).toContain('Outage');
    expect(msg.text).toContain('System is down');
    expect(msg.text).toContain('🚨'); // critical emoji
  });

  it('discord:alert blocks agent posts when no webhook configured', async () => {
    const result = await executor.execute('alert', {
      channel: '1489421585555555555',
      text: 'System is down',
      severity: 'critical',
      agentName: 'sentinel',
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/No webhook configured/);
    expect(adapter.send).not.toHaveBeenCalled();
  });

  // ─── Health check ───────────────────────────────────────────────────

  it('healthCheck delegates to adapter.healthy', async () => {
    adapter.healthy.mockResolvedValueOnce(true);
    expect(await executor.healthCheck()).toBe(true);

    adapter.healthy.mockResolvedValueOnce(false);
    expect(await executor.healthCheck()).toBe(false);
  });
});
