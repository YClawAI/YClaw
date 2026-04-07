import { createHash } from 'node:crypto';
import { WebClient } from '@slack/web-api';
import type { Redis } from 'ioredis';
import type { ActionResult, ActionExecutor } from './types.js';
import type { ToolDefinition } from '../config/schema.js';
import { createLogger } from '../logging/logger.js';

const logger = createLogger('slack-executor');

// ─── Slack Action Executor ──────────────────────────────────────────────────
//
// Actions:
//   slack:message            - Post a message to a channel
//   slack:alert              - Post a message with alert formatting (red sidebar)
//   slack:thread_reply       - Reply in a thread
//   slack:dm                 - Send a direct message to a user
//   slack:get_channel_history - Get recent messages from a channel
//   slack:get_thread         - Get all replies in a thread
//
// Required env vars:
//   SLACK_BOT_TOKEN - Bot User OAuth Token (xoxb-...)
//
// Identity override (chat:write.customize):
//   All message actions accept optional `username` and `icon_url` params
//   to post under a per-agent identity instead of the default bot name.
//

// ─── Department → Channel Routing ───────────────────────────────────────────

export const SLACK_CHANNELS = {
  general: '#yclaw-general',
  executive: '#yclaw-executive',
  marketing: '#yclaw-marketing',
  development: '#yclaw-development',
  operations: '#yclaw-operations',
  finance: '#yclaw-finance',
  support: '#yclaw-support',
  alerts: '#yclaw-alerts',
  audit: '#yclaw-audit',
} as const;

// ─── Agent Identity Map ─────────────────────────────────────────────────────
// Maps agent name → display identity for Slack messages

export const AGENT_IDENTITIES: Record<string, { username: string; icon_emoji: string }> = {
  strategist:  { username: 'Strategist',  icon_emoji: ':chess_pawn:' },
  reviewer:    { username: 'Reviewer',    icon_emoji: ':mag:' },
  ember:       { username: 'Ember',       icon_emoji: ':fire:' },
  scout:       { username: 'Scout',       icon_emoji: ':telescope:' },
  forge:       { username: 'Forge',       icon_emoji: ':hammer_and_wrench:' },
  architect:   { username: 'Architect',   icon_emoji: ':building_construction:' },
  deployer:    { username: 'Deployer',    icon_emoji: ':rocket:' },
  sentinel:    { username: 'Sentinel',    icon_emoji: ':shield:' },
  signal:      { username: 'Signal',      icon_emoji: ':satellite:' },
  keeper:      { username: 'Keeper',      icon_emoji: ':key:' },
  treasurer:   { username: 'Treasurer',   icon_emoji: ':bank:' },
  guide:       { username: 'Guide',       icon_emoji: ':compass:' },
};

// ─── Constants ──────────────────────────────────────────────────────────────

const MAX_HISTORY_LIMIT = 200;
const DEFAULT_HISTORY_LIMIT = 50;

export class SlackExecutor implements ActionExecutor {
  readonly name = 'slack';
  private client: WebClient | null = null;
  private channelIdCache = new Map<string, string>();
  private readonly redis: Redis | null;

  // ─── Dedup ─────────────────────────────────────────────────────────────────
  private static readonly DEDUP_PREFIX = 'slack:dedup:';
  private static readonly DEFAULT_DEDUP_TTL = 3600; // 1 hour

  /** Channel-specific dedup windows (seconds). */
  private static readonly CHANNEL_DEDUP_TTL: Record<string, number> = {
    'C0AFA847NAD': 7200,  // #yclaw-alerts: 2 hours
    'C0AETTBE893': 3600,  // #yclaw-executive: 1 hour
    'C0AEV8L9KTQ': 1800,  // #yclaw-development: 30 min
    'C0AEFSQV0RM': 1800,  // #yclaw-marketing: 30 min
  };

  constructor(redis?: Redis | null) {
    this.redis = redis ?? null;

    const botToken = process.env.SLACK_BOT_TOKEN;

    if (!botToken) {
      logger.warn(
        'Slack bot token not configured. Set SLACK_BOT_TOKEN environment variable.',
      );
      return;
    }

    this.client = new WebClient(botToken);
  }

  // ─── Dedup Methods ──────────────────────────────────────────────────────────

  /**
   * Generate a fingerprint for a Slack message.
   * Normalizes volatile fields (IDs, timestamps, counts) so semantically
   * identical messages produce the same fingerprint.
   */
  fingerprint(channel: string, text: string): string {
    const normalized = text
      .toLowerCase()
      .replace(/dep-\d+-[a-z0-9]+/g, 'dep-ID')
      .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, 'UUID')
      .replace(/\d{4}-\d{2}-\d{2}[tT ]\d{2}:\d{2}[:\d.]*/g, 'TIMESTAMP')
      .replace(/`[a-f0-9]{7,12}`/g, '`COMMIT`')
      .replace(/\d{2}:\d{2}(:\d{2})?(\.\d+)?/g, 'TIME')
      .replace(/\d+ (task|minute|hour|day|pr|issue)/g, 'N $1')
      .trim();

    return createHash('sha256').update(`${channel}:${normalized}`).digest('hex').slice(0, 32);
  }

  /**
   * Check if a similar message was recently posted.
   * Returns true if the message should be suppressed.
   */
  async isDuplicate(channel: string, text: string): Promise<boolean> {
    if (!this.redis) return false;

    const fp = this.fingerprint(channel, text);
    const key = `${SlackExecutor.DEDUP_PREFIX}${fp}`;
    const ttl = SlackExecutor.CHANNEL_DEDUP_TTL[channel] ?? SlackExecutor.DEFAULT_DEDUP_TTL;

    try {
      const result = await this.redis.set(key, Date.now().toString(), 'EX', ttl, 'NX');
      return result === null; // null = key already existed → duplicate
    } catch (err) {
      logger.warn('Dedup check failed, allowing message', {
        error: err instanceof Error ? err.message : String(err),
      });
      return false; // Fail-open: if Redis is down, allow the message
    }
  }

  // ─── Tool Definitions (colocated schemas) ─────────────────────────────────

  getToolDefinitions(): ToolDefinition[] {
    return [
      {
        name: 'slack:message',
        description: 'Post a message to a Slack channel',
        parameters: {
          channel: { type: 'string', description: 'Channel name or ID (e.g., "#yclaw-development")', required: true },
          text: { type: 'string', description: 'Message text content', required: true },
          thread_ts: { type: 'string', description: 'Thread timestamp to reply in a thread (optional)' },
          username: { type: 'string', description: 'Display name override (requires chat:write.customize scope)' },
          icon_emoji: { type: 'string', description: 'Emoji icon override (e.g., ":hammer:")' },
          blocks: { type: 'object', description: 'Slack Block Kit blocks array for rich message formatting' },
        },
      },
      {
        name: 'slack:thread_reply',
        description: 'Reply to an existing message thread in Slack',
        parameters: {
          channel: { type: 'string', description: 'Channel name or ID where the thread exists', required: true },
          threadTs: { type: 'string', description: 'Timestamp of the parent message to reply to', required: true },
          text: { type: 'string', description: 'Reply text content', required: true },
          username: { type: 'string', description: 'Display name override (requires chat:write.customize scope)' },
          icon_emoji: { type: 'string', description: 'Emoji icon override (e.g., ":hammer:")' },
          blocks: { type: 'object', description: 'Slack Block Kit blocks array for rich message formatting' },
        },
      },
      {
        name: 'slack:get_channel_history',
        description: 'Get recent messages from a Slack channel. Channel names are auto-resolved to IDs. Limit is clamped to 1-200.',
        parameters: {
          channel: { type: 'string', description: 'Channel name or ID (e.g., "#yclaw-development" or "C01234ABCDE")', required: true },
          limit: { type: 'number', description: 'Number of messages to retrieve (default: 50, max: 200)' },
        },
      },
      {
        name: 'slack:get_thread',
        description: 'Get all replies in a Slack thread. Channel names are auto-resolved to IDs.',
        parameters: {
          channel: { type: 'string', description: 'Channel name or ID where the thread exists (e.g., "#yclaw-development" or "C01234ABCDE")', required: true },
          thread_ts: { type: 'string', description: 'Timestamp of the parent message', required: true },
        },
      },
      {
        name: 'slack:alert',
        description: 'Post a message with alert formatting (colored sidebar) to a Slack channel',
        parameters: {
          channel: { type: 'string', description: 'Channel name or ID (e.g., "#yclaw-alerts")', required: true },
          text: { type: 'string', description: 'Alert message text', required: true },
          severity: { type: 'string', description: 'Alert severity: info, warning, error, critical, or success (default: warning)' },
          title: { type: 'string', description: 'Alert title (optional, defaults to severity-based title)' },
          username: { type: 'string', description: 'Display name override (requires chat:write.customize scope)' },
          icon_emoji: { type: 'string', description: 'Emoji icon override (e.g., ":rotating_light:")' },
        },
      },
      {
        name: 'slack:dm',
        description: 'Send a direct message to a Slack user',
        parameters: {
          userId: { type: 'string', description: 'Slack user ID to send the DM to', required: true },
          text: { type: 'string', description: 'Message text content', required: true },
          blocks: { type: 'object', description: 'Slack Block Kit blocks array for rich message formatting' },
        },
      },
    ];
  }

  // ─── Defaults for parameter injection ─────────────────────────────────────

  static readonly DEFAULTS: Record<string, Record<string, unknown>> = {
    'slack:get_channel_history': { limit: DEFAULT_HISTORY_LIMIT },
  };

  async execute(action: string, params: Record<string, unknown>): Promise<ActionResult> {
    if (!this.client) {
      return { success: false, error: 'Slack client not initialized: missing SLACK_BOT_TOKEN' };
    }

    switch (action) {
      case 'message':
        return this.postMessage(params);
      case 'alert':
        return this.postAlert(params);
      case 'thread_reply':
        return this.threadReply(params);
      case 'dm':
        return this.sendDM(params);
      case 'get_channel_history':
        return this.getChannelHistory(params);
      case 'get_thread':
        return this.getThread(params);
      default:
        return { success: false, error: `Unknown Slack action: ${action}` };
    }
  }

  async healthCheck(): Promise<boolean> {
    if (!this.client) return false;
    try {
      const result = await this.client.auth.test();
      return !!result.ok;
    } catch (err) {
      logger.error('Slack health check failed', { error: (err as Error).message });
      return false;
    }
  }

  // ─── Channel ID Resolution ────────────────────────────────────────────────
  // conversations.history and conversations.replies require channel IDs,
  // not human-readable names. This helper resolves #channel-name or
  // plain channel-name strings to Slack channel IDs via conversations.list.

  async resolveChannelId(channelInput: string): Promise<string> {
    // Already a channel ID (starts with C, D, or G followed by alphanumeric)
    if (/^[CDG][A-Z0-9]{8,}$/.test(channelInput)) {
      return channelInput;
    }

    // Strip leading # if present
    const channelName = channelInput.replace(/^#/, '');

    // Check cache
    const cached = this.channelIdCache.get(channelName);
    if (cached) {
      return cached;
    }

    // Fetch from Slack API
    logger.info('Resolving channel name to ID', { channelName });

    let cursor: string | undefined;
    do {
      const result = await this.client!.conversations.list({
        types: 'public_channel,private_channel',
        limit: 200,
        cursor,
      });

      for (const ch of result.channels || []) {
        if (ch.name && ch.id) {
          this.channelIdCache.set(ch.name, ch.id);
        }
      }

      const resolved = this.channelIdCache.get(channelName);
      if (resolved) {
        return resolved;
      }

      cursor = result.response_metadata?.next_cursor || undefined;
    } while (cursor);

    throw new Error(
      `Channel not found: "${channelInput}". ` +
      'Provide a valid channel ID or name the bot has access to.',
    );
  }

  // ─── Post a message to a channel ──────────────────────────────────────────

  private async postMessage(params: Record<string, unknown>): Promise<ActionResult> {
    const channel = params.channel as string | undefined;
    const text = params.text as string | undefined;
    const blocks = params.blocks as Record<string, unknown>[] | undefined;
    const username = params.username as string | undefined;
    const iconEmoji = params.icon_emoji as string | undefined;
    const iconUrl = params.icon_url as string | undefined;

    if (!channel || !text) {
      return { success: false, error: 'Missing required parameters: channel, text' };
    }

    // Dedup check — suppress duplicate messages to the same channel
    if (await this.isDuplicate(channel, text)) {
      logger.info('Slack message suppressed (duplicate)', { channel });
      return { success: true, data: { suppressed: true, reason: 'duplicate_within_window' } };
    }

    logger.info('Posting Slack message', { channel, textLength: text.length, username });

    try {
      const result = await this.client!.chat.postMessage({
        channel,
        text,
        blocks: blocks as never,
        ...(username && { username }),
        ...(iconEmoji && { icon_emoji: iconEmoji }),
        ...(iconUrl && { icon_url: iconUrl }),
      } as any);

      logger.info('Slack message posted', { channel, ts: result.ts });
      return {
        success: true,
        data: { ts: result.ts, channel: result.channel },
      };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.error('Failed to post Slack message', { error: errorMsg, channel });
      return { success: false, error: `Failed to post message: ${errorMsg}` };
    }
  }

  // ─── Post a message with alert formatting ─────────────────────────────────

  private async postAlert(params: Record<string, unknown>): Promise<ActionResult> {
    const channel = params.channel as string | undefined;
    const text = params.text as string | undefined;
    const severity = (params.severity as string) || 'warning';
    const title = params.title as string | undefined;

    if (!channel || !text) {
      return { success: false, error: 'Missing required parameters: channel, text' };
    }

    // Dedup check — suppress duplicate alerts to the same channel
    if (await this.isDuplicate(channel, text)) {
      logger.info('Slack alert suppressed (duplicate)', { channel, severity });
      return { success: true, data: { suppressed: true, reason: 'duplicate_within_window' } };
    }

    // Map severity to color
    const colorMap: Record<string, string> = {
      info: '#2196F3',
      warning: '#FF9800',
      error: '#F44336',
      critical: '#B71C1C',
      success: '#4CAF50',
    };

    const color = colorMap[severity] || colorMap.warning;

    logger.info('Posting Slack alert', { channel, severity, title });

    const username = params.username as string | undefined;
    const iconEmoji = params.icon_emoji as string | undefined;

    try {
      const result = await this.client!.chat.postMessage({
        channel,
        text: `[${severity.toUpperCase()}] ${title || text}`,
        attachments: [
          {
            color,
            title: title || `Alert: ${severity.toUpperCase()}`,
            text,
            footer: 'YClaw Alert System',
            ts: String(Math.floor(Date.now() / 1000)),
          },
        ],
        ...(username && { username }),
        ...(iconEmoji && { icon_emoji: iconEmoji }),
      });

      logger.info('Slack alert posted', { channel, ts: result.ts, severity });
      return {
        success: true,
        data: { ts: result.ts, channel: result.channel, severity },
      };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.error('Failed to post Slack alert', { error: errorMsg, channel });
      return { success: false, error: `Failed to post alert: ${errorMsg}` };
    }
  }

  // ─── Reply in a thread ────────────────────────────────────────────────────

  private async threadReply(params: Record<string, unknown>): Promise<ActionResult> {
    const channel = params.channel as string | undefined;
    const text = params.text as string | undefined;
    const threadTs = params.threadTs as string | undefined;
    const blocks = params.blocks as Record<string, unknown>[] | undefined;

    if (!channel || !text || !threadTs) {
      return { success: false, error: 'Missing required parameters: channel, text, threadTs' };
    }

    const username = params.username as string | undefined;
    const iconEmoji = params.icon_emoji as string | undefined;

    logger.info('Posting Slack thread reply', { channel, threadTs, username });

    try {
      const result = await this.client!.chat.postMessage({
        channel,
        text,
        thread_ts: threadTs,
        blocks: blocks as never,
        ...(username && { username }),
        ...(iconEmoji && { icon_emoji: iconEmoji }),
      });

      logger.info('Slack thread reply posted', { channel, ts: result.ts, threadTs });
      return {
        success: true,
        data: { ts: result.ts, channel: result.channel, threadTs },
      };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.error('Failed to post Slack thread reply', { error: errorMsg, channel, threadTs });
      return { success: false, error: `Failed to reply in thread: ${errorMsg}` };
    }
  }

  // ─── Get channel history ──────────────────────────────────────────────────

  private async getChannelHistory(params: Record<string, unknown>): Promise<ActionResult> {
    const channel = params.channel as string | undefined;
    const rawLimit = params.limit as number | undefined;
    const limit = Math.min(
      Math.max((rawLimit ?? DEFAULT_HISTORY_LIMIT), 1),
      MAX_HISTORY_LIMIT,
    );

    if (!channel) {
      return { success: false, error: 'Missing required parameter: channel' };
    }

    logger.info('Getting channel history', { channel, limit });

    try {
      const channelId = await this.resolveChannelId(channel);

      const result = await this.client!.conversations.history({
        channel: channelId,
        limit,
      });

      if (!result.ok) {
        return { success: false, error: `Slack API error: ${result.error}` };
      }

      const messages = (result.messages || []).map(msg => ({
        ts: msg.ts,
        text: msg.text,
        user: msg.user,
        type: msg.type,
        thread_ts: msg.thread_ts,
        reply_count: msg.reply_count,
      }));

      logger.info('Channel history retrieved', { channel, channelId, messageCount: messages.length });
      return {
        success: true,
        data: { channel, channelId, messages, has_more: result.has_more },
      };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.error('Failed to get channel history', { error: errorMsg, channel });
      return { success: false, error: `Failed to get channel history: ${errorMsg}` };
    }
  }

  // ─── Get thread replies ───────────────────────────────────────────────────

  private async getThread(params: Record<string, unknown>): Promise<ActionResult> {
    const channel = params.channel as string | undefined;
    const threadTs = params.thread_ts as string | undefined;

    if (!channel || !threadTs) {
      return { success: false, error: 'Missing required parameters: channel, thread_ts' };
    }

    logger.info('Getting thread replies', { channel, threadTs });

    try {
      const channelId = await this.resolveChannelId(channel);

      const result = await this.client!.conversations.replies({
        channel: channelId,
        ts: threadTs,
      });

      if (!result.ok) {
        return { success: false, error: `Slack API error: ${result.error}` };
      }

      const messages = (result.messages || []).map(msg => ({
        ts: msg.ts,
        text: msg.text,
        user: msg.user,
        type: msg.type,
        thread_ts: msg.thread_ts,
      }));

      logger.info('Thread replies retrieved', { channel, channelId, threadTs, messageCount: messages.length });
      return {
        success: true,
        data: { channel, channelId, thread_ts: threadTs, messages },
      };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.error('Failed to get thread replies', { error: errorMsg, channel, threadTs });
      return { success: false, error: `Failed to get thread: ${errorMsg}` };
    }
  }

  // ─── Send a DM to a user ──────────────────────────────────────────────────

  private async sendDM(params: Record<string, unknown>): Promise<ActionResult> {
    const userId = params.userId as string | undefined;
    const text = params.text as string | undefined;
    const blocks = params.blocks as Record<string, unknown>[] | undefined;

    if (!userId || !text) {
      return { success: false, error: 'Missing required parameters: userId, text' };
    }

    logger.info('Sending Slack DM', { userId, textLength: text.length });

    try {
      // Open a DM conversation first
      const conversationResult = await this.client!.conversations.open({
        users: userId,
      });

      const dmChannelId = conversationResult.channel?.id;
      if (!dmChannelId) {
        return { success: false, error: `Failed to open DM channel with user ${userId}` };
      }

      // Send the message to the DM channel
      const result = await this.client!.chat.postMessage({
        channel: dmChannelId,
        text,
        blocks: blocks as never,
      });

      logger.info('Slack DM sent', { userId, ts: result.ts, dmChannel: dmChannelId });
      return {
        success: true,
        data: { ts: result.ts, channel: dmChannelId, userId },
      };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.error('Failed to send Slack DM', { error: errorMsg, userId });
      return { success: false, error: `Failed to send DM: ${errorMsg}` };
    }
  }
}
