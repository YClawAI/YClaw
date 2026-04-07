import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const originalEnv = { ...process.env };

// ─── Mock Setup ─────────────────────────────────────────────────────────────
//
// vi.hoisted() runs before vi.mock() hoisting, guaranteeing the mock fns
// exist when the factory executes. This is the vitest v4 recommended pattern.
//
// We define a plain class (not vi.fn()) as the WebClient mock so that
// `new WebClient(token)` always works — vi.fn().mockImplementation() can be
// fragile across clearAllMocks/resetModules in ESM mode.

const { mockConversationsHistory, mockConversationsReplies, mockConversationsList, mockAuthTest } =
  vi.hoisted(() => ({
    mockConversationsHistory: vi.fn(),
    mockConversationsReplies: vi.fn(),
    mockConversationsList: vi.fn(),
    mockAuthTest: vi.fn(),
  }));

vi.mock('@slack/web-api', () => {
  // Return a real class so `new WebClient(token)` always constructs properly.
  class MockWebClient {
    conversations = {
      history: mockConversationsHistory,
      replies: mockConversationsReplies,
      list: mockConversationsList,
    };
    auth = {
      test: mockAuthTest,
    };
  }
  return { WebClient: MockWebClient };
});

async function makeSlackExecutor() {
  // Dynamic import so the constructor runs with the current process.env.
  // vi.mock intercepts at the module level, so the mock is always active.
  const m = await import('../src/actions/slack.js');
  return new m.SlackExecutor();
}

describe('SlackExecutor — getChannelHistory & getThread', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv, SLACK_BOT_TOKEN: 'fake' };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  // ─── resolveChannelId ─────────────────────────────────────────────────

  describe('resolveChannelId()', () => {
    it('passes through a valid channel ID without API call', async () => {
      const executor = await makeSlackExecutor();

      mockConversationsHistory.mockResolvedValueOnce({
        ok: true,
        messages: [{ ts: '1.0', text: 'hello' }],
      });

      const result = await executor.execute('get_channel_history', {
        channel: 'C01ABCDEF23',
        limit: 5,
      });

      expect(result.success).toBe(true);
      expect(mockConversationsList).not.toHaveBeenCalled();
      expect(mockConversationsHistory).toHaveBeenCalledWith(
        expect.objectContaining({ channel: 'C01ABCDEF23' }),
      );
    });

    it('resolves #channel-name to channel ID via conversations.list', async () => {
      const executor = await makeSlackExecutor();

      mockConversationsList.mockResolvedValueOnce({
        channels: [
          { name: 'yclaw-general', id: 'C111111111' },
          { name: 'yclaw-development', id: 'C222222222' },
        ],
        response_metadata: { next_cursor: '' },
      });

      mockConversationsHistory.mockResolvedValueOnce({
        ok: true,
        messages: [],
      });

      const result = await executor.execute('get_channel_history', {
        channel: '#yclaw-development',
      });

      expect(result.success).toBe(true);
      expect(mockConversationsList).toHaveBeenCalled();
      expect(mockConversationsHistory).toHaveBeenCalledWith(
        expect.objectContaining({ channel: 'C222222222' }),
      );
    });

    it('resolves channel name without # prefix', async () => {
      const executor = await makeSlackExecutor();

      mockConversationsList.mockResolvedValueOnce({
        channels: [{ name: 'yclaw-alerts', id: 'C333333333' }],
        response_metadata: { next_cursor: '' },
      });

      mockConversationsHistory.mockResolvedValueOnce({
        ok: true,
        messages: [],
      });

      const result = await executor.execute('get_channel_history', {
        channel: 'yclaw-alerts',
      });

      expect(result.success).toBe(true);
      expect(mockConversationsHistory).toHaveBeenCalledWith(
        expect.objectContaining({ channel: 'C333333333' }),
      );
    });

    it('returns error when channel name cannot be resolved', async () => {
      const executor = await makeSlackExecutor();

      mockConversationsList.mockResolvedValueOnce({
        channels: [{ name: 'yclaw-general', id: 'C111111111' }],
        response_metadata: { next_cursor: '' },
      });

      const result = await executor.execute('get_channel_history', {
        channel: '#nonexistent-channel',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Channel not found');
      expect(result.error).toContain('nonexistent-channel');
    });

    it('paginates conversations.list to find channel', async () => {
      const executor = await makeSlackExecutor();

      mockConversationsList.mockResolvedValueOnce({
        channels: [{ name: 'yclaw-general', id: 'C111111111' }],
        response_metadata: { next_cursor: 'cursor_page2' },
      });

      mockConversationsList.mockResolvedValueOnce({
        channels: [{ name: 'yclaw-development', id: 'C222222222' }],
        response_metadata: { next_cursor: '' },
      });

      mockConversationsHistory.mockResolvedValueOnce({
        ok: true,
        messages: [],
      });

      const result = await executor.execute('get_channel_history', {
        channel: '#yclaw-development',
      });

      expect(result.success).toBe(true);
      expect(mockConversationsList).toHaveBeenCalledTimes(2);
      expect(mockConversationsHistory).toHaveBeenCalledWith(
        expect.objectContaining({ channel: 'C222222222' }),
      );
    });

    it('caches resolved channel IDs across calls', async () => {
      const executor = await makeSlackExecutor();

      mockConversationsList.mockResolvedValueOnce({
        channels: [{ name: 'yclaw-development', id: 'C222222222' }],
        response_metadata: { next_cursor: '' },
      });

      mockConversationsHistory.mockResolvedValue({
        ok: true,
        messages: [],
      });

      await executor.execute('get_channel_history', {
        channel: '#yclaw-development',
      });
      await executor.execute('get_channel_history', {
        channel: '#yclaw-development',
      });

      expect(mockConversationsList).toHaveBeenCalledTimes(1);
      expect(mockConversationsHistory).toHaveBeenCalledTimes(2);
    });
  });

  // ─── getChannelHistory ────────────────────────────────────────────────

  describe('getChannelHistory()', () => {
    it('returns error when channel param is missing', async () => {
      const executor = await makeSlackExecutor();
      const result = await executor.execute('get_channel_history', {});

      expect(result.success).toBe(false);
      expect(result.error).toContain('Missing required parameter: channel');
    });

    it('returns messages on success', async () => {
      const executor = await makeSlackExecutor();

      mockConversationsHistory.mockResolvedValueOnce({
        ok: true,
        has_more: false,
        messages: [
          {
            ts: '1700000001.000',
            text: 'Hello world',
            user: 'U123',
            type: 'message',
            reply_count: 2,
          },
          {
            ts: '1700000000.000',
            text: 'First message',
            user: 'U456',
            type: 'message',
          },
        ],
      });

      const result = await executor.execute('get_channel_history', {
        channel: 'C01ABCDEF23',
        limit: 10,
      });

      expect(result.success).toBe(true);
      expect(result.data?.messages).toHaveLength(2);
      expect((result.data?.messages as any[])[0]).toEqual({
        ts: '1700000001.000',
        text: 'Hello world',
        user: 'U123',
        type: 'message',
        thread_ts: undefined,
        reply_count: 2,
      });
      expect(result.data?.has_more).toBe(false);
    });

    it('defaults limit to 50', async () => {
      const executor = await makeSlackExecutor();

      mockConversationsHistory.mockResolvedValueOnce({
        ok: true,
        messages: [],
      });

      await executor.execute('get_channel_history', {
        channel: 'C01ABCDEF23',
      });

      expect(mockConversationsHistory).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 50 }),
      );
    });

    it('clamps limit to max 200', async () => {
      const executor = await makeSlackExecutor();

      mockConversationsHistory.mockResolvedValueOnce({
        ok: true,
        messages: [],
      });

      await executor.execute('get_channel_history', {
        channel: 'C01ABCDEF23',
        limit: 999,
      });

      expect(mockConversationsHistory).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 200 }),
      );
    });

    it('clamps limit to min 1', async () => {
      const executor = await makeSlackExecutor();

      mockConversationsHistory.mockResolvedValueOnce({
        ok: true,
        messages: [],
      });

      await executor.execute('get_channel_history', {
        channel: 'C01ABCDEF23',
        limit: -5,
      });

      expect(mockConversationsHistory).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 1 }),
      );
    });

    it('returns error on Slack API failure', async () => {
      const executor = await makeSlackExecutor();

      mockConversationsHistory.mockRejectedValueOnce(
        new Error('channel_not_found'),
      );

      const result = await executor.execute('get_channel_history', {
        channel: 'C01ABCDEF23',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('channel_not_found');
    });

    it('includes channelId in response data', async () => {
      const executor = await makeSlackExecutor();

      mockConversationsList.mockResolvedValueOnce({
        channels: [{ name: 'yclaw-development', id: 'C222222222' }],
        response_metadata: { next_cursor: '' },
      });

      mockConversationsHistory.mockResolvedValueOnce({
        ok: true,
        messages: [],
      });

      const result = await executor.execute('get_channel_history', {
        channel: '#yclaw-development',
      });

      expect(result.success).toBe(true);
      expect(result.data?.channelId).toBe('C222222222');
      expect(result.data?.channel).toBe('#yclaw-development');
    });
  });

  // ─── getThread ────────────────────────────────────────────────────────

  describe('getThread()', () => {
    it('returns error when channel is missing', async () => {
      const executor = await makeSlackExecutor();
      const result = await executor.execute('get_thread', {
        thread_ts: '1700000000.000',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Missing required parameters');
    });

    it('returns error when thread_ts is missing', async () => {
      const executor = await makeSlackExecutor();
      const result = await executor.execute('get_thread', {
        channel: 'C01ABCDEF23',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Missing required parameters');
    });

    it('returns thread messages on success', async () => {
      const executor = await makeSlackExecutor();

      mockConversationsReplies.mockResolvedValueOnce({
        ok: true,
        messages: [
          {
            ts: '1700000000.000',
            text: 'Parent message',
            user: 'U123',
            type: 'message',
            thread_ts: '1700000000.000',
          },
          {
            ts: '1700000001.000',
            text: 'Reply 1',
            user: 'U456',
            type: 'message',
            thread_ts: '1700000000.000',
          },
          {
            ts: '1700000002.000',
            text: 'Reply 2',
            user: 'U789',
            type: 'message',
            thread_ts: '1700000000.000',
          },
        ],
      });

      const result = await executor.execute('get_thread', {
        channel: 'C01ABCDEF23',
        thread_ts: '1700000000.000',
      });

      expect(result.success).toBe(true);
      expect(result.data?.messages).toHaveLength(3);
      expect(result.data?.thread_ts).toBe('1700000000.000');
    });

    it('resolves channel name before calling replies', async () => {
      const executor = await makeSlackExecutor();

      mockConversationsList.mockResolvedValueOnce({
        channels: [{ name: 'yclaw-development', id: 'C222222222' }],
        response_metadata: { next_cursor: '' },
      });

      mockConversationsReplies.mockResolvedValueOnce({
        ok: true,
        messages: [],
      });

      const result = await executor.execute('get_thread', {
        channel: '#yclaw-development',
        thread_ts: '1700000000.000',
      });

      expect(result.success).toBe(true);
      expect(mockConversationsReplies).toHaveBeenCalledWith(
        expect.objectContaining({ channel: 'C222222222' }),
      );
    });

    it('includes channelId in response data', async () => {
      const executor = await makeSlackExecutor();

      mockConversationsList.mockResolvedValueOnce({
        channels: [{ name: 'yclaw-development', id: 'C222222222' }],
        response_metadata: { next_cursor: '' },
      });

      mockConversationsReplies.mockResolvedValueOnce({
        ok: true,
        messages: [],
      });

      const result = await executor.execute('get_thread', {
        channel: '#yclaw-development',
        thread_ts: '1700000000.000',
      });

      expect(result.success).toBe(true);
      expect(result.data?.channelId).toBe('C222222222');
    });

    it('returns error on Slack API failure', async () => {
      const executor = await makeSlackExecutor();

      mockConversationsReplies.mockRejectedValueOnce(
        new Error('thread_not_found'),
      );

      const result = await executor.execute('get_thread', {
        channel: 'C01ABCDEF23',
        thread_ts: '1700000000.000',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('thread_not_found');
    });
  });
});
