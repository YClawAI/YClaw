/**
 * DiscordExecutor — orchestrates all Discord agent actions.
 *
 * Delegates to focused sub-modules:
 *   - channel-resolver  → resolveChannelId
 *   - rate-limiter      → isDuplicate, checkChannelRateLimits, checkThreadRateLimits
 *   - webhook-manager   → WebhookManager
 *   - thread-manager    → ThreadManager (overflow, thread replies)
 *   - message-poster    → postMessage, postAlert
 *   - history-fetcher   → getChannelHistory, getThread
 *   - reaction-handler  → react, createThread
 *   - tool-definitions  → DISCORD_TOOL_DEFAULTS, getDiscordToolDefinitions
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

import { resolveChannelId } from './channel-resolver.js';
import { fingerprint, isDuplicate, checkChannelRateLimits, checkThreadRateLimits } from './rate-limiter.js';
import { WebhookManager } from './webhook-manager.js';
import { ThreadManager } from './thread-manager.js';
import { DISCORD_TOOL_DEFAULTS, getDiscordToolDefinitions } from './tool-definitions.js';
import { postMessage, postAlert } from './message-poster.js';
import { getChannelHistory, getThread } from './history-fetcher.js';
import { react, createThread } from './reaction-handler.js';

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

  static readonly DEFAULTS: Record<string, Record<string, unknown>> = DISCORD_TOOL_DEFAULTS;

  getToolDefinitions(): ToolDefinition[] {
    return getDiscordToolDefinitions();
  }

  // ─── Dispatch ────────────────────────────────────────────────────────────

  async execute(action: string, params: Record<string, unknown>): Promise<ActionResult> {
    // No DMs — reject anything that targets a user instead of a channel.
    if (params.userId && !params.channel) {
      return { success: false, error: 'Discord DMs are not supported. Use a channel or thread.' };
    }

    switch (action) {
      case 'message':      return postMessage(params, this.adapter, this.redis, this.webhookManager, this.threadManager);
      case 'thread_reply': return this.threadReply(params);
      case 'create_thread': return createThread(params, this.adapter);
      case 'get_channel_history': return getChannelHistory(params, this.adapter);
      case 'get_thread':   return getThread(params, this.adapter);
      case 'react':        return react(params, this.adapter);
      case 'alert':        return postAlert(params, this.adapter, this.redis, this.webhookManager);
      default:
        return { success: false, error: `Unknown Discord action: ${action}` };
    }
  }

  // ─── Thread reply (kept here: uses multiple sub-modules together) ────────

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
}
