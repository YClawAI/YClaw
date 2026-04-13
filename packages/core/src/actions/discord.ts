import { createHash } from 'node:crypto';
import type { Redis } from 'ioredis';
import type { ActionResult, ActionExecutor } from './types.js';
import type { ToolDefinition } from '../config/schema.js';
import type { DiscordChannelAdapter } from '../adapters/channels/DiscordChannelAdapter.js';
import { createLogger } from '../logging/logger.js';
import { getChannelForDepartment, getChannelForAgent } from '../utils/channel-routing.js';
import type { Department } from '../utils/channel-routing.js';
import { getAgentIdentity } from '../notifications/AgentRegistry.js';

const logger = createLogger('discord-executor');

// ─── Discord Action Executor ────────────────────────────────────────────────
//
// Actions:
//   discord:message            - Post a message to a channel
//   discord:thread_reply       - Reply in a thread
//   discord:create_thread      - Start a thread on a message
//   discord:get_channel_history - Get recent messages from a channel
//   discord:get_thread         - Get all replies in a thread
//   discord:react              - Add a reaction to a message
//   discord:alert              - Post a message with alert formatting
//
// Required env vars:
//   DISCORD_BOT_TOKEN — Discord bot token (read by DiscordChannelAdapter)
//
// Guardrails (all MUST be enforced):
//   - 90s per-channel cooldown per agent, 30s per-thread cooldown per agent
//   - 20 messages/hour/agent global cap
//   - 600 char max on public-channel messages (threads exempt)
//   - Dedup fingerprinting (1h window, copied from SlackExecutor)
//   - No DMs — any user-targeted action is rejected
//   - Channel resolution: symbolic names in DISCORD_CHANNELS or raw snowflakes
//
// The executor does NOT own the Discord client. It wraps a shared
// DiscordChannelAdapter (created by InfrastructureFactory) so the same
// gateway connection is reused for outbound notifications (ChannelNotifier),
// agent tool calls (this executor), and inbound event handling
// (DiscordEventHandler).
//

// ─── Agent identity is sourced from AgentRegistry ───────────────────────────
// Use getAgentIdentity(agentName) — covers all 13 agents with emoji, name,
// department, and avatarUrl. No local identity map needed.

// ─── Constants ──────────────────────────────────────────────────────────────

const DEFAULT_HISTORY_LIMIT = 50;
const MAX_HISTORY_LIMIT = 100;

const PUBLIC_MESSAGE_MAX_LEN = 600;

/** Per-agent, per-channel cooldown for top-level messages (seconds). */
const CHANNEL_COOLDOWN_S = 90;
/** Per-agent, per-thread cooldown for thread replies (seconds). */
const THREAD_COOLDOWN_S = 30;
/** Global per-agent hourly cap. */
const HOURLY_CAP = 20;
const HOURLY_WINDOW_S = 3600;
/** Dedup window (seconds). */
const DEDUP_TTL_S = 3600;

const DEDUP_PREFIX = 'discord:dedup:';
const COOLDOWN_PREFIX = 'discord:cooldown:';
const COOLDOWN_THREAD_PREFIX = 'discord:cooldown:thread:';
const HOURLY_PREFIX = 'discord:hourly:';

/** Departments that support webhook-based routing. */
const WEBHOOK_DEPARTMENTS = [
  'executive', 'development', 'operations', 'marketing',
  'finance', 'support', 'audit', 'alerts', 'general',
] as const;

// ─── Executor ───────────────────────────────────────────────────────────────

export class DiscordExecutor implements ActionExecutor {
  readonly name = 'discord';
  private readonly adapter: DiscordChannelAdapter;
  private readonly redis: Redis | null;

  /** Per-department webhook clients for agent identity override. */
  private webhookClients = new Map<string, any>();
  /** Reverse map: channelId → department (for matching target channel to webhook). */
  private channelToDept = new Map<string, string>();
  private webhooksInitialized = false;

  constructor(adapter: DiscordChannelAdapter, redis?: Redis | null) {
    this.adapter = adapter;
    this.redis = redis ?? null;

    if (!process.env.DISCORD_BOT_TOKEN) {
      logger.warn('DISCORD_BOT_TOKEN not configured; DiscordExecutor will be non-functional until the adapter connects.');
    }
    logger.info('DiscordExecutor initialized', { redisEnabled: !!this.redis });
  }

  /** Lazy-init webhook clients from DISCORD_WEBHOOK_* env vars. */
  private async initWebhooks(): Promise<void> {
    if (this.webhooksInitialized) return;
    this.webhooksInitialized = true;

    // Build reverse map: channelId → department
    for (const dept of WEBHOOK_DEPARTMENTS) {
      const channelId = process.env[`DISCORD_CHANNEL_${dept.toUpperCase()}`]?.trim();
      if (channelId) {
        this.channelToDept.set(channelId, dept);
      }
    }

    let hasAny = false;
    for (const dept of WEBHOOK_DEPARTMENTS) {
      const url = process.env[`DISCORD_WEBHOOK_${dept.toUpperCase()}`]?.trim();
      if (!url) continue;

      try {
        // eslint-disable-next-line @typescript-eslint/no-implied-eval
        const dynamicImport = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<any>;
        const { WebhookClient } = await dynamicImport('discord.js');
        this.webhookClients.set(dept, new WebhookClient({ url }));
        hasAny = true;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error('Failed to create Discord webhook client', { department: dept, error: msg });
      }
    }

    if (hasAny) {
      logger.info('Discord webhooks initialized for executor', {
        departments: [...this.webhookClients.keys()],
      });
    }
  }

  /**
   * Find the webhook for a target channel. Looks up which department owns
   * the channel, then returns the webhook for that department (if any).
   */
  private getWebhookForChannel(channelId: string): any | undefined {
    const dept = this.channelToDept.get(channelId);
    if (!dept) return undefined;
    return this.webhookClients.get(dept);
  }

  async healthCheck(): Promise<boolean> {
    return this.adapter.healthy();
  }

  // ─── Tool Definitions ───────────────────────────────────────────────────

  getToolDefinitions(): ToolDefinition[] {
    return [
      {
        name: 'discord:message',
        description: 'Post a message to a Discord channel (max 600 chars). Use a thread for longer replies.',
        parameters: {
          channel: { type: 'string', description: 'Channel name from DISCORD_CHANNELS (e.g. "support") or raw snowflake ID. Omit to use department default.' },
          text: { type: 'string', description: 'Message content (max 600 characters in public channels)', required: true },
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
        description: 'Post an alert message (colored embed) to a Discord channel. Bypasses the 600-char public limit since alerts use an embed body.',
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

  // ─── Defaults for parameter injection ─────────────────────────────────────

  static readonly DEFAULTS: Record<string, Record<string, unknown>> = {
    'discord:get_channel_history': { limit: DEFAULT_HISTORY_LIMIT },
    'discord:get_thread': { limit: DEFAULT_HISTORY_LIMIT },
  };

  // ─── Dispatch ───────────────────────────────────────────────────────────

  async execute(action: string, params: Record<string, unknown>): Promise<ActionResult> {
    // No DMs — reject anything that targets a user instead of a channel.
    if (params.userId && !params.channel) {
      return { success: false, error: 'Discord DMs are not supported. Use a channel or thread.' };
    }

    switch (action) {
      case 'message':
        return this.postMessage(params);
      case 'thread_reply':
        return this.threadReply(params);
      case 'create_thread':
        return this.createThread(params);
      case 'get_channel_history':
        return this.getChannelHistory(params);
      case 'get_thread':
        return this.getThread(params);
      case 'react':
        return this.react(params);
      case 'alert':
        return this.postAlert(params);
      default:
        return { success: false, error: `Unknown Discord action: ${action}` };
    }
  }

  // ─── Channel Resolution ─────────────────────────────────────────────────

  /**
   * Accept a symbolic channel name from DISCORD_CHANNELS or a raw snowflake
   * ID. Returns the resolved ID or throws if the name isn't known.
   */
  resolveChannelId(input: string): string {
    const trimmed = input.trim();
    // 1. Try env-var-based routing first (DISCORD_CHANNEL_<DEPT>)
    const fromEnv = getChannelForDepartment(trimmed as Department, 'discord');
    if (fromEnv) return fromEnv;
    // 2. Try as agent name → department → channel
    const fromAgent = getChannelForAgent(trimmed, 'discord');
    if (fromAgent) return fromAgent;
    // 3. Raw Discord snowflake
    if (/^\d{17,20}$/.test(trimmed)) return trimmed;
    // 4. Last resort: try general channel
    const general = getChannelForDepartment('general', 'discord');
    if (general) {
      logger.warn('Channel not found, falling back to general', { input: trimmed });
      return general;
    }
    throw new Error(`Unknown Discord channel: "${input}". Set DISCORD_CHANNEL_<DEPT> env vars or use a snowflake ID.`);
  }

  // ─── Dedup ──────────────────────────────────────────────────────────────

  /**
   * Semantic fingerprint of a (channel, text) pair. Normalizes volatile
   * substrings (UUIDs, timestamps, task ids, commit SHAs) so that
   * semantically identical messages collapse to the same key. Copied from
   * SlackExecutor.fingerprint and extended with discord-specific patterns
   * (Discord snowflakes).
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
      // Discord snowflakes
      .replace(/\b\d{17,20}\b/g, 'SNOWFLAKE')
      .trim();

    return createHash('sha256').update(`${channel}:${normalized}`).digest('hex').slice(0, 32);
  }

  async isDuplicate(channelId: string, text: string): Promise<boolean> {
    if (!this.redis) return false;
    const fp = this.fingerprint(channelId, text);
    const key = `${DEDUP_PREFIX}${fp}`;
    try {
      const result = await this.redis.set(key, Date.now().toString(), 'EX', DEDUP_TTL_S, 'NX');
      return result === null;
    } catch (err) {
      logger.warn('Discord dedup check failed, allowing message', {
        error: err instanceof Error ? err.message : String(err),
      });
      return false; // fail-open
    }
  }

  // ─── Rate Limiting ──────────────────────────────────────────────────────

  private hourBucket(): string {
    const d = new Date();
    return `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}-${d.getUTCDate()}-${d.getUTCHours()}`;
  }

  /**
   * Check all three rate limits for a top-level channel post. Returns null
   * on pass, or a string reason on rejection. Fails open if Redis is down.
   */
  private async checkChannelRateLimits(agentName: string, channelId: string): Promise<string | null> {
    return this.checkRateLimits(
      agentName,
      `${COOLDOWN_PREFIX}${agentName}:${channelId}`,
      CHANNEL_COOLDOWN_S,
      `channel cooldown active (${CHANNEL_COOLDOWN_S}s) for ${agentName} in ${channelId}`,
      'Discord rate-limit check failed, allowing message (fail-open)',
    );
  }

  /**
   * Check thread reply rate limits (thread cooldown + hourly cap).
   */
  private async checkThreadRateLimits(agentName: string, threadId: string): Promise<string | null> {
    return this.checkRateLimits(
      agentName,
      `${COOLDOWN_THREAD_PREFIX}${agentName}:${threadId}`,
      THREAD_COOLDOWN_S,
      `thread cooldown active (${THREAD_COOLDOWN_S}s) for ${agentName} in ${threadId}`,
      'Discord thread rate-limit check failed, allowing message (fail-open)',
    );
  }

  private async checkRateLimits(
    agentName: string,
    cooldownKey: string,
    cooldownSeconds: number,
    cooldownMessage: string,
    failureLogMessage: string,
  ): Promise<string | null> {
    if (!this.redis) return null;

    const hourKey = `${HOURLY_PREFIX}${agentName}:${this.hourBucket()}`;

    try {
      const result = await this.redis.eval(
        `
          local hourCount = tonumber(redis.call('GET', KEYS[1]) or '0')
          if hourCount >= tonumber(ARGV[1]) then
            return 'hourly_cap'
          end

          local cooldownSet = redis.call('SET', KEYS[2], '1', 'EX', ARGV[2], 'NX')
          if not cooldownSet then
            return 'cooldown'
          end

          local newHourCount = redis.call('INCR', KEYS[1])
          if newHourCount == 1 then
            redis.call('EXPIRE', KEYS[1], ARGV[3])
          end

          return 'ok'
        `,
        2,
        hourKey,
        cooldownKey,
        HOURLY_CAP.toString(),
        cooldownSeconds.toString(),
        HOURLY_WINDOW_S.toString(),
      );

      if (result === 'ok') return null;
      if (result === 'hourly_cap') {
        return `global hourly cap of ${HOURLY_CAP} msgs reached for ${agentName}`;
      }
      if (result === 'cooldown') {
        return cooldownMessage;
      }

      logger.warn('Discord rate-limit script returned unexpected result, allowing message (fail-open)', {
        agentName,
        result,
      });
      return null;
    } catch (err) {
      logger.warn(failureLogMessage, {
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }

  // ─── Actions ────────────────────────────────────────────────────────────

  private async postMessage(params: Record<string, unknown>): Promise<ActionResult> {
    const channelInput = params.channel as string | undefined;
    const text = params.text as string | undefined;
    const replyToMessageId = params.replyToMessageId as string | undefined;
    const agentName = (params.agentName as string | undefined) ?? 'system';

    if (!channelInput || !text) {
      return { success: false, error: 'Missing required parameters: channel, text' };
    }

    if (text.length > PUBLIC_MESSAGE_MAX_LEN) {
      return { success: false, error: `Message exceeds ${PUBLIC_MESSAGE_MAX_LEN} character limit for public channels. Use a thread for longer content.` };
    }

    let channelId: string;
    try {
      channelId = this.resolveChannelId(channelInput);
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }

    if (await this.isDuplicate(channelId, text)) {
      logger.info('Discord message suppressed (duplicate)', { channelId, agentName });
      return { success: true, data: { suppressed: true, reason: 'duplicate_within_window' } };
    }

    const rateLimitReason = await this.checkChannelRateLimits(agentName, channelId);
    if (rateLimitReason) {
      logger.info('Discord message suppressed (rate limited)', { channelId, agentName, reason: rateLimitReason });
      return { success: true, data: { suppressed: true, reason: 'rate_limited', detail: rateLimitReason } };
    }

    const identity = getAgentIdentity(agentName);
    logger.info('Posting Discord message', {
      channelId, agentName, textLength: text.length,
    });

    // Try webhook path for agent identity
    try { await this.initWebhooks(); } catch (err) {
      logger.warn('Webhook init failed, will use bot fallback', { error: err instanceof Error ? err.message : String(err) });
    }
    const webhook = this.getWebhookForChannel(channelId);
    if (webhook) {
      try {
        const sendOptions: Record<string, unknown> = {
          content: text,
          username: `${identity.emoji} ${identity.name}`,
        };
        if (identity.avatarUrl) {
          sendOptions.avatarURL = identity.avatarUrl;
        }
        if (replyToMessageId) {
          sendOptions.threadId = replyToMessageId;
        }
        const msg = await webhook.send(sendOptions);
        return { success: true, data: { messageId: msg.id, channelId, agentName } };
      } catch (err) {
        logger.warn('Webhook send failed, falling back to bot', {
          error: err instanceof Error ? err.message : String(err),
          channelId, agentName,
        });
        // Fall through to bot send
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
    const finalText = prefix + text;

    const result = await this.adapter.send(
      { channelId },
      {
        text: finalText,
        ...(replyToMessageId ? { replyTo: { messageId: replyToMessageId, channelId } } : {}),
      },
    );

    if (!result.success) {
      logger.error('Failed to post Discord message', { channelId, error: result.error });
      return { success: false, error: `Failed to post message: ${result.error ?? 'unknown error'}` };
    }
    return {
      success: true,
      data: { messageId: result.messageId, channelId, agentName },
    };
  }

  private async threadReply(params: Record<string, unknown>): Promise<ActionResult> {
    const channelInput = params.channel as string | undefined;
    const threadId = params.threadId as string | undefined;
    const text = params.text as string | undefined;
    const agentName = (params.agentName as string | undefined) ?? 'system';

    if (!channelInput || !threadId || !text) {
      return { success: false, error: 'Missing required parameters: channel, threadId, text' };
    }

    let channelId: string;
    try {
      channelId = this.resolveChannelId(channelInput);
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }

    // Thread replies allow longer text (Discord caps at 2000 natively)
    if (await this.isDuplicate(threadId, text)) {
      return { success: true, data: { suppressed: true, reason: 'duplicate_within_window' } };
    }

    const rateLimitReason = await this.checkThreadRateLimits(agentName, threadId);
    if (rateLimitReason) {
      logger.info('Discord thread reply suppressed (rate limited)', { threadId, agentName, reason: rateLimitReason });
      return { success: true, data: { suppressed: true, reason: 'rate_limited', detail: rateLimitReason } };
    }

    logger.info('Posting Discord thread reply', {
      channelId, threadId, agentName, textLength: text.length,
    });

    // Try webhook path for agent identity
    const identity = getAgentIdentity(agentName);
    try { await this.initWebhooks(); } catch (err) {
      logger.warn('Webhook init failed, will use bot fallback', { error: err instanceof Error ? err.message : String(err) });
    }
    const threadWebhook = this.getWebhookForChannel(channelId);
    if (threadWebhook) {
      try {
        const sendOptions: Record<string, unknown> = {
          content: text,
          username: `${identity.emoji} ${identity.name}`,
          threadId,
        };
        if (identity.avatarUrl) {
          sendOptions.avatarURL = identity.avatarUrl;
        }
        const msg = await threadWebhook.send(sendOptions);
        return { success: true, data: { messageId: msg.id, channelId, threadId, agentName } };
      } catch (err) {
        logger.warn('Webhook thread reply failed, falling back to bot', {
          error: err instanceof Error ? err.message : String(err),
          channelId, threadId, agentName,
        });
      }
    }

    // Agent posts require webhook identity — block bot fallback to prevent "APP" tag
    if (agentName !== 'system') {
      logger.warn('Blocking agent Discord thread reply — no webhook available', { channelId, threadId, agentName });
      return { success: false, error: `No webhook configured for channel ${channelId}. Agent ${agentName} cannot reply without webhook identity.` };
    }

    // Bot fallback — only for system/orchestrator messages
    const prefix = `**${identity.emoji} ${identity.name}**\n`;
    const finalText = prefix + text;

    const result = await this.adapter.send(
      { channelId, threadId },
      { text: finalText, threadId },
    );

    if (!result.success) {
      return { success: false, error: `Failed to post thread reply: ${result.error ?? 'unknown error'}` };
    }
    return {
      success: true,
      data: { messageId: result.messageId, channelId, threadId, agentName },
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
      channelId = this.resolveChannelId(channelInput);
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }

    try {
      if (typeof this.adapter.createThread !== 'function') {
        return { success: false, error: 'Discord adapter does not implement createThread' };
      }
      const thread = await this.adapter.createThread({ messageId, channelId }, name);
      return {
        success: true,
        data: { threadId: thread.threadId, channelId: thread.channelId, name },
      };
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
      channelId = this.resolveChannelId(channelInput);
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
      channelId = this.resolveChannelId(channelInput);
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
      channelId = this.resolveChannelId(channelInput);
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }

    if (await this.isDuplicate(channelId, text)) {
      return { success: true, data: { suppressed: true, reason: 'duplicate_within_window' } };
    }

    const rateLimitReason = await this.checkChannelRateLimits(agentName, channelId);
    if (rateLimitReason) {
      return { success: true, data: { suppressed: true, reason: 'rate_limited', detail: rateLimitReason } };
    }

    // Render the embed as plain markdown for the IChannel.send() call. The
    // adapter doesn't expose embeds in the IChannel contract, so we pack the
    // severity + title into a formatted text block. This keeps alerts
    // distinctive without widening the interface.
    const severityEmoji: Record<string, string> = {
      info: 'ℹ️',
      warning: '⚠️',
      error: '❌',
      critical: '🚨',
      success: '✅',
    };
    const emoji = severityEmoji[severity] ?? '⚠️';
    const header = `${emoji} **${(title ?? `${severity.toUpperCase()} alert`)}**`;
    const formatted = `${header}\n${text}`;

    // Try webhook path for agent identity
    const identity = getAgentIdentity(agentName);
    try { await this.initWebhooks(); } catch (err) {
      logger.warn('Webhook init failed, will use bot fallback', { error: err instanceof Error ? err.message : String(err) });
    }
    const alertWebhook = this.getWebhookForChannel(channelId);
    if (alertWebhook) {
      try {
        const sendOptions: Record<string, unknown> = {
          content: formatted,
          username: `${identity.emoji} ${identity.name}`,
        };
        if (identity.avatarUrl) {
          sendOptions.avatarURL = identity.avatarUrl;
        }
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
    const finalFormatted = prefix + formatted;

    const result = await this.adapter.send(
      { channelId },
      { text: finalFormatted },
    );

    if (!result.success) {
      return { success: false, error: `Failed to post alert: ${result.error ?? 'unknown error'}` };
    }
    return {
      success: true,
      data: { messageId: result.messageId, channelId, severity, agentName },
    };
  }
}
