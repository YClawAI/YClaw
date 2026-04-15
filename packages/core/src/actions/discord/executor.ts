/**
 * DiscordExecutor — orchestrates all Discord agent actions.
 *
 * Delegates to focused sub-modules:
 *   - channel-resolver  → resolveChannelId
 *   - rate-limiter      → isDuplicate, checkChannelRateLimits, checkThreadRateLimits
 *   - webhook-manager   → WebhookManager
 *   - thread-manager    → ThreadManager (overflow, thread replies)
 *
 * Actions:
 *   discord:message            - Post a message to a channel
 *   discord:thread_reply       - Reply in a thread
 *   discord:create_thread      - Start a thread on a message
 *   discord:get_channel_history - Get recent messages from a channel
 *   discord:get_thread         - Get all replies in a thread
 *   discord:react              - Add a reaction to a message
 *   discord:alert              - Post a message with alert formatting
 */

import type { Redis } from 'ioredis';
import type { ActionResult, ActionExecutor } from '../types.js';
import type { ToolDefinition } from '../../config/schema.js';
import type { DiscordChannelAdapter } from '../../adapters/channels/DiscordChannelAdapter.js';
import { createLogger } from '../../logging/logger.js';
import { getAgentIdentity } from '../../notifications/AgentRegistry.js';
import { getChannelForAgent } from '../../utils/channel-routing.js';

import { resolveChannelId } from './channel-resolver.js';
import { fingerprint, isDuplicate, checkChannelRateLimits, checkThreadRateLimits } from './rate-limiter.js';
import { WebhookManager } from './webhook-manager.js';
import { ThreadManager } from './thread-manager.js';
import { PUBLIC_MESSAGE_MAX_LEN, DEFAULT_HISTORY_LIMIT, MAX_HISTORY_LIMIT } from './types.js';

const logger = createLogger('discord-executor');

export class DiscordExecutor implements ActionExecutor {
  readonly name = 'discord';
  private readonly adapter: DiscordChannelAdapter;
  private readonly redis: Redis | null;
  private readonly webhookManager: WebhookManager;
  private readonly threadManager: ThreadManager;

  constructor(adapter: DiscordChannelAdapter, redis?: Redis | null) {
    this.adapter = adapter;
    this.redis = redis ?? null;
    this.webhookManager = new WebhookManager();
    this.threadManager = new ThreadManager(adapter, this.webhookManager, this.redis);

    if (!process.env.DISCORD_BOT_TOKEN) {
      logger.warn('DISCORD_BOT_TOKEN not configured; DiscordExecutor will be non-functional until the adapter connects.');
    }
    logger.info('DiscordExecutor initialized', { redisEnabled: !!this.redis });
  }

  async healthCheck(): Promise<boolean> {
    return this.adapter.healthy();
  }

  // ─── Public helpers (used by tests + bootstrap) ──────────────────────────

  /** @see channel-resolver.resolveChannelId */
  resolveChannelId(input: string): string {
    return resolveChannelId(input);
  }

  /** @see rate-limiter.fingerprint */
  fingerprint(channel: string, text: string): string {
    return fingerprint(channel, text);
  }

  /** @see rate-limiter.isDuplicate */
  async isDuplicate(channelId: string, text: string): Promise<boolean> {
    return isDuplicate(channelId, text, this.redis);
  }

  // ─── Tool Definitions ────────────────────────────────────────────────────

  static readonly DEFAULTS: Record<string, Record<string, unknown>> = {
    'discord:get_channel_history': { limit: DEFAULT_HISTORY_LIMIT },
    'discord:get_thread': { limit: DEFAULT_HISTORY_LIMIT },
  };

  getToolDefinitions(): ToolDefinition[] {
    return [
      {
        name: 'discord:message',
        description: 'Post a message to a Discord channel (max 2000 chars).',
        parameters: {
          channel: { type: 'string', description: 'Channel name from DISCORD_CHANNELS (e.g. "support") or raw snowflake ID. Omit to use department default.' },
          text: { type: 'string', description: 'Message content (max 2000 characters)', required: true },
          replyToMessageId: { type: 'string', description: 'Optional message ID to reply to' },
          agentName: { type: 'string', description: 'Agent identity key for display name override (e.g. "keeper")' },
        },
      },
      {
        name: 'discord:thread_reply',
        description: 'Reply inside an existing Discord thread. Character limit is the Discord native 2000 char limit.',
        parameters: {
          channel: { type: 'string', description: 'Channel containing the thread (symbolic name or snowflake)', required: true },
          threadId: { type: 'string', description: 'Thread ID (Discord threads are sub-channels with their own IDs)', required: true },
          text: { type: 'string', description: 'Reply content', required: true },
          agentName: { type: 'string', description: 'Agent identity key' },
        },
      },
      {
        name: 'discord:create_thread',
        description: 'Create a new thread anchored on a message in a Discord channel.',
        parameters: {
          channel: { type: 'string', description: 'Channel containing the anchor message', required: true },
          messageId: { type: 'string', description: 'Message ID to start the thread from', required: true },
          name: { type: 'string', description: 'Thread name', required: true },
        },
      },
      {
        name: 'discord:get_channel_history',
        description: 'Fetch recent messages from a Discord channel (read-only).',
        parameters: {
          channel: { type: 'string', description: 'Channel name or snowflake', required: true },
          limit: { type: 'number', description: 'Max messages to fetch (default 50, max 100)' },
        },
      },
      {
        name: 'discord:get_thread',
        description: 'Fetch messages from a Discord thread (read-only).',
        parameters: {
          threadId: { type: 'string', description: 'Thread ID', required: true },
          limit: { type: 'number', description: 'Max messages to fetch (default 50, max 100)' },
        },
      },
      {
        name: 'discord:react',
        description: 'Add an emoji reaction to a Discord message.',
        parameters: {
          channel: { type: 'string', description: 'Channel containing the message', required: true },
          messageId: { type: 'string', description: 'Message ID to react to', required: true },
          emoji: { type: 'string', description: 'Unicode emoji or custom emoji string (e.g. "👍" or "custom_name:12345")', required: true },
        },
      },
      {
        name: 'discord:alert',
        description: 'Post an alert message (colored embed) to a Discord channel.',
        parameters: {
          channel: { type: 'string', description: 'Channel name or snowflake', required: true },
          text: { type: 'string', description: 'Alert body text', required: true },
          severity: { type: 'string', description: 'Severity: info | warning | error | critical | success (default: warning)' },
          title: { type: 'string', description: 'Optional alert title' },
          agentName: { type: 'string', description: 'Agent identity key' },
        },
      },
    ];
  }

  // ─── Dispatch ────────────────────────────────────────────────────────────

  async execute(action: string, params: Record<string, unknown>): Promise<ActionResult> {
    // No DMs — reject anything that targets a user instead of a channel.
    if (params.userId && !params.channel) {
      return { success: false, error: 'Discord DMs are not supported. Use a channel or thread.' };
    }

    switch (action) {
      case 'message':          return this.postMessage(params);
      case 'thread_reply':     return this.threadReply(params);
      case 'create_thread':    return this.createThread(params);
      case 'get_channel_history': return this.getChannelHistory(params);
      case 'get_thread':       return this.getThread(params);
      case 'react':            return this.react(params);
      case 'alert':            return this.postAlert(params);
      default:
        return { success: false, error: `Unknown Discord action: ${action}` };
    }
  }

  // ─── Action Handlers ─────────────────────────────────────────────────────

  private async postMessage(params: Record<string, unknown>): Promise<ActionResult> {
    let channelInput = params.channel as string | undefined;
    const text = params.text as string | undefined;
    const replyToMessageId = params.replyToMessageId as string | undefined;
    const agentName = (params.agentName as string | undefined) ?? 'system';

    // Belt-and-suspenders: enforce department channel routing inside DiscordExecutor.
    if (agentName && agentName !== 'system') {
      const SUPPORT_AGENTS = ['keeper', 'guide'];
      if (!SUPPORT_AGENTS.includes(agentName)) {
        const deptChannel = getChannelForAgent(agentName, 'discord');
        if (deptChannel && channelInput !== deptChannel) {
          logger.info('[discord-executor-enforcement] overriding channel', {
            agentName,
            from: channelInput,
            to: deptChannel,
          });
          channelInput = deptChannel;
        }
      }
    }

    if (!channelInput || !text) {
      return { success: false, error: 'Missing required parameters: channel, text' };
    }

    let channelId: string;
    try {
      channelId = resolveChannelId(channelInput);
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }

    // Auto-thread overflow for messages exceeding Discord's 2000-char limit
    if (text.length > PUBLIC_MESSAGE_MAX_LEN) {
      return this.threadManager.postWithThreadOverflow(channelId, text, agentName);
    }

    if (await isDuplicate(channelId, text, this.redis)) {
      logger.info('Discord message suppressed (duplicate)', { channelId, agentName });
      return { success: true, data: { suppressed: true, reason: 'duplicate_within_window' } };
    }

    const rateLimitReason = await checkChannelRateLimits(agentName, channelId, this.redis);
    if (rateLimitReason) {
      logger.info('Discord message suppressed (rate limited)', { channelId, agentName, reason: rateLimitReason });
      return { success: true, data: { suppressed: true, reason: 'rate_limited', detail: rateLimitReason } };
    }

    const identity = getAgentIdentity(agentName);
    logger.info('Posting Discord message', { channelId, agentName, textLength: text.length });

    // Try webhook path for agent identity
    try { await this.webhookManager.init(); } catch (err) {
      logger.warn('Webhook init failed, will use bot fallback', { error: err instanceof Error ? err.message : String(err) });
    }
    const webhook = this.webhookManager.getWebhookForChannel(channelId);
    if (webhook) {
      try {
        const sendOptions: Record<string, unknown> = {
          content: text,
          username: `${identity.emoji} ${identity.name}`,
        };
        if (identity.avatarUrl) sendOptions.avatarURL = identity.avatarUrl;
        if (replyToMessageId) sendOptions.threadId = replyToMessageId;
        const msg = await webhook.send(sendOptions);
        return { success: true, data: { messageId: msg.id, channelId, agentName } };
      } catch (err) {
        logger.warn('Webhook send failed, falling back to bot', {
          error: err instanceof Error ? err.message : String(err),
          channelId, agentName,
        });
      }
    } else {
      logger.debug('No webhook configured for channel', { channelId, agentName });
    }

    // Agent posts require webhook identity — block bot fallback to prevent "APP" tag
    if (agentName !== 'system') {
      logger.warn('Blocking agent Discord post — no webhook available', { channelId, agentName });
      return { success: false, error: `No webhook configured for channel ${channelId}. Agent ${agentName} cannot post without webhook identity.` };
    }

    // Bot fallback — only for system/orchestrator messages
    const prefix = `**${identity.emoji} ${identity.name}**\n`;
    const result = await this.adapter.send(
      { channelId },
      {
        text: prefix + text,
        ...(replyToMessageId ? { replyTo: { messageId: replyToMessageId, channelId } } : {}),
      },
    );

    if (!result.success) {
      logger.error('Failed to post Discord message', { channelId, error: result.error });
      return { success: false, error: `Failed to post message: ${result.error ?? 'unknown error'}` };
    }
    return { success: true, data: { messageId: result.messageId, channelId, agentName } };
  }

  private async threadReply(params: Record<string, unknown>): Promise<ActionResult> {
    const channelInput = params.channel as string | undefined;
    const threadIdOrMessageId = params.threadId as string | undefined;
    const text = params.text as string | undefined;
    const agentName = (params.agentName as string | undefined) ?? 'system';

    if (!channelInput || !threadIdOrMessageId || !text) {
      return { success: false, error: 'Missing required parameters: channel, threadId, text' };
    }

    let channelId: string;
    try {
      channelId = resolveChannelId(channelInput);
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }

    if (await isDuplicate(threadIdOrMessageId, text, this.redis)) {
      return { success: true, data: { suppressed: true, reason: 'duplicate_within_window' } };
    }

    const rateLimitReason = await checkThreadRateLimits(agentName, threadIdOrMessageId, this.redis);
    if (rateLimitReason) {
      logger.info('Discord thread reply suppressed (rate limited)', {
        threadId: threadIdOrMessageId, agentName, reason: rateLimitReason,
      });
      return { success: true, data: { suppressed: true, reason: 'rate_limited', detail: rateLimitReason } };
    }

    const identity = getAgentIdentity(agentName);
    const personaName = `${identity.emoji} ${identity.name}`;

    // Ensure thread exists (create-first, never try-fail-retry)
    let threadId: string;
    try {
      threadId = await this.threadManager.ensureThreadExists(channelId, threadIdOrMessageId, personaName);
    } catch (err) {
      logger.warn('Failed to ensure thread exists', {
        error: err instanceof Error ? err.message : String(err),
        channelId, threadIdOrMessageId, agentName,
      });
      return { success: false, error: `Failed to create/resolve thread: ${err instanceof Error ? err.message : String(err)}` };
    }

    logger.info('Posting Discord thread reply', { channelId, threadId, agentName, textLength: text.length });

    const result = await this.threadManager.sendToThreadWithFallback({
      channelId, threadId, text, agentName,
    });

    if (!result.messageId) {
      return { success: false, error: 'Failed to post thread reply via both webhook and bot' };
    }

    return {
      success: true,
      data: { messageId: result.messageId, channelId, threadId, agentName, botFallback: result.botFallback },
    };
  }

  private async createThread(params: Record<string, unknown>): Promise<ActionResult> {
    const channelInput = params.channel as string | undefined;
    const messageId = params.messageId as string | undefined;
    const name = params.name as string | undefined;

    if (!channelInput || !messageId || !name) {
      return { success: false, error: 'Missing required parameters: channel, messageId, name' };
    }

    let channelId: string;
    try {
      channelId = resolveChannelId(channelInput);
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }

    try {
      if (typeof this.adapter.createThread !== 'function') {
        return { success: false, error: 'Discord adapter does not implement createThread' };
      }
      const thread = await this.adapter.createThread({ messageId, channelId }, name);
      return { success: true, data: { threadId: thread.threadId, channelId: thread.channelId, name } };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('Failed to create Discord thread', { channelId, messageId, error: msg });
      return { success: false, error: `Failed to create thread: ${msg}` };
    }
  }

  private async getChannelHistory(params: Record<string, unknown>): Promise<ActionResult> {
    const channelInput = params.channel as string | undefined;
    const limit = typeof params.limit === 'number'
      ? Math.min(Math.max(params.limit, 1), MAX_HISTORY_LIMIT)
      : DEFAULT_HISTORY_LIMIT;

    if (!channelInput) {
      return { success: false, error: 'Missing required parameter: channel' };
    }

    let channelId: string;
    try {
      channelId = resolveChannelId(channelInput);
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }

    try {
      const messages = await this.adapter.fetchChannelHistory(channelId, limit);
      return { success: true, data: { channel: channelInput, channelId, messages } };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('Failed to fetch Discord channel history', { channelId, error: msg });
      return { success: false, error: `Failed to fetch channel history: ${msg}` };
    }
  }

  private async getThread(params: Record<string, unknown>): Promise<ActionResult> {
    const threadId = params.threadId as string | undefined;
    const limit = typeof params.limit === 'number'
      ? Math.min(Math.max(params.limit, 1), MAX_HISTORY_LIMIT)
      : DEFAULT_HISTORY_LIMIT;

    if (!threadId) {
      return { success: false, error: 'Missing required parameter: threadId' };
    }

    try {
      const messages = await this.adapter.fetchThreadReplies(threadId, limit);
      return { success: true, data: { threadId, messages } };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('Failed to fetch Discord thread replies', { threadId, error: msg });
      return { success: false, error: `Failed to fetch thread: ${msg}` };
    }
  }

  private async react(params: Record<string, unknown>): Promise<ActionResult> {
    const channelInput = params.channel as string | undefined;
    const messageId = params.messageId as string | undefined;
    const emoji = params.emoji as string | undefined;

    if (!channelInput || !messageId || !emoji) {
      return { success: false, error: 'Missing required parameters: channel, messageId, emoji' };
    }

    let channelId: string;
    try {
      channelId = resolveChannelId(channelInput);
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }

    try {
      if (typeof this.adapter.react !== 'function') {
        return { success: false, error: 'Discord adapter does not implement react' };
      }
      await this.adapter.react({ messageId, channelId }, emoji);
      return { success: true, data: { channelId, messageId, emoji } };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('Failed to add Discord reaction', { channelId, messageId, error: msg });
      return { success: false, error: `Failed to react: ${msg}` };
    }
  }

  private async postAlert(params: Record<string, unknown>): Promise<ActionResult> {
    const channelInput = params.channel as string | undefined;
    const text = params.text as string | undefined;
    const severity = (params.severity as string | undefined) ?? 'warning';
    const title = params.title as string | undefined;
    const agentName = (params.agentName as string | undefined) ?? 'system';

    if (!channelInput || !text) {
      return { success: false, error: 'Missing required parameters: channel, text' };
    }

    let channelId: string;
    try {
      channelId = resolveChannelId(channelInput);
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }

    if (await isDuplicate(channelId, text, this.redis)) {
      return { success: true, data: { suppressed: true, reason: 'duplicate_within_window' } };
    }

    const rateLimitReason = await checkChannelRateLimits(agentName, channelId, this.redis);
    if (rateLimitReason) {
      return { success: true, data: { suppressed: true, reason: 'rate_limited', detail: rateLimitReason } };
    }

    const severityEmoji: Record<string, string> = {
      info: 'ℹ️', warning: '⚠️', error: '❌', critical: '🚨', success: '✅',
    };
    const emoji = severityEmoji[severity] ?? '⚠️';
    const header = `${emoji} **${title ?? `${severity.toUpperCase()} alert`}**`;
    const formatted = `${header}\n${text}`;

    const identity = getAgentIdentity(agentName);
    try { await this.webhookManager.init(); } catch (err) {
      logger.warn('Webhook init failed, will use bot fallback', { error: err instanceof Error ? err.message : String(err) });
    }
    const alertWebhook = this.webhookManager.getWebhookForChannel(channelId);
    if (alertWebhook) {
      try {
        const sendOptions: Record<string, unknown> = {
          content: formatted,
          username: `${identity.emoji} ${identity.name}`,
        };
        if (identity.avatarUrl) sendOptions.avatarURL = identity.avatarUrl;
        const msg = await alertWebhook.send(sendOptions);
        return { success: true, data: { messageId: msg.id, channelId, severity, agentName } };
      } catch (err) {
        logger.warn('Webhook alert failed, falling back to bot', {
          error: err instanceof Error ? err.message : String(err),
          channelId, agentName,
        });
      }
    }

    // Agent posts require webhook identity — block bot fallback to prevent "APP" tag
    if (agentName !== 'system') {
      logger.warn('Blocking agent Discord alert — no webhook available', { channelId, agentName });
      return { success: false, error: `No webhook configured for channel ${channelId}. Agent ${agentName} cannot post alert without webhook identity.` };
    }

    // Bot fallback — only for system/orchestrator messages
    const prefix = `**${identity.emoji} ${identity.name}**\n`;
    const result = await this.adapter.send({ channelId }, { text: prefix + formatted });

    if (!result.success) {
      return { success: false, error: `Failed to post alert: ${result.error ?? 'unknown error'}` };
    }
    return { success: true, data: { messageId: result.messageId, channelId, severity, agentName } };
  }
}
