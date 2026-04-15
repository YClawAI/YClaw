/**
 * Thread management for Discord executor.
 *
 * Handles:
 *   - Text chunking for messages that exceed Discord limits
 *   - Thread existence checks and create-first creation
 *   - Chunked delivery via raw webhook (with bot fallback)
 *   - Auto-thread overflow for channel messages > 2000 chars
 */

import { createLogger } from '../../logging/logger.js';
import { getAgentIdentity } from '../../notifications/AgentRegistry.js';
import type { DiscordChannelAdapter } from '../../adapters/channels/DiscordChannelAdapter.js';
import type { ActionResult } from '../types.js';
import type { Redis } from 'ioredis';
import type { WebhookManager } from './webhook-manager.js';
import { isDuplicate, checkChannelRateLimits } from './rate-limiter.js';

const logger = createLogger('discord:thread-manager');

/**
 * Split text into chunks at natural break points (newlines > spaces > hard).
 */
export function chunkText(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }
    let breakAt = remaining.lastIndexOf('\n', maxLen);
    if (breakAt < maxLen * 0.5) breakAt = remaining.lastIndexOf(' ', maxLen);
    if (breakAt < maxLen * 0.3) breakAt = maxLen;
    chunks.push(remaining.substring(0, breakAt));
    remaining = remaining.substring(breakAt).trimStart();
  }
  return chunks;
}

export class ThreadManager {
  constructor(
    private readonly adapter: DiscordChannelAdapter,
    private readonly webhookManager: WebhookManager,
    private readonly redis: Redis | null,
  ) {}

  /**
   * Ensure a thread exists for the given ID. If the ID is a plain message (not
   * yet a thread), creates a thread on it first. Returns the resolved thread ID.
   * Follows the "create-first" pattern — never try-fail-retry.
   */
  async ensureThreadExists(
    channelId: string,
    threadIdOrMessageId: string,
    threadName: string,
  ): Promise<string> {
    // Quick check: try to fetch the ID as a thread channel.
    try {
      await this.adapter.fetchThreadReplies(threadIdOrMessageId, 1);
      return threadIdOrMessageId; // already a thread
    } catch {
      // Not a thread yet — fall through to creation
    }

    if (typeof this.adapter.createThread !== 'function') {
      throw new Error('Discord adapter does not support thread creation');
    }

    const displayName =
      (threadName.length > 90 ? threadName.slice(0, 90) + '…' : threadName) + ' — Details';

    logger.info('Creating thread from message (create-first)', {
      channelId,
      messageId: threadIdOrMessageId,
      threadName: displayName,
    });

    const ref = await this.adapter.createThread(
      { channelId, messageId: threadIdOrMessageId },
      displayName,
    );
    return ref.threadId;
  }

  /**
   * Post content to a thread via raw webhook REST (?thread_id= pattern).
   * Falls back to the bot adapter if the webhook path fails.
   */
  async sendToThreadWithFallback(params: {
    channelId: string;
    threadId: string;
    text: string;
    agentName: string;
  }): Promise<{ messageId?: string; botFallback: boolean }> {
    const { channelId, threadId, text, agentName } = params;
    const identity = getAgentIdentity(agentName);
    const personaName = `${identity.emoji} ${identity.name}`;

    try { await this.webhookManager.init(); } catch { /* ignore */ }
    const creds = this.webhookManager.getCredentialsForChannel(channelId);

    // Try raw webhook with ?thread_id= first (OpenClaw pattern)
    if (creds) {
      try {
        const chunks = chunkText(text, 1950);
        let lastMsgId: string | undefined;
        for (const chunk of chunks) {
          const result = await this.webhookManager.executeRaw({
            webhookId: creds.id,
            webhookToken: creds.token,
            content: chunk,
            username: personaName,
            avatarUrl: identity.avatarUrl,
            threadId,
          });
          lastMsgId = result.id;
        }
        return { messageId: lastMsgId, botFallback: false };
      } catch (err) {
        logger.warn('Raw webhook thread post failed, falling back to bot', {
          error: err instanceof Error ? err.message : String(err),
          channelId,
          threadId,
          agentName,
        });
      }
    }

    // Bot fallback — content delivery > identity purity (council mandate)
    const prefix = agentName !== 'system' ? `**${personaName}**\n` : '';
    const chunks = chunkText(text, 1900);
    let lastMsgId: string | undefined;
    for (const chunk of chunks) {
      const result = await this.adapter.send(
        { channelId, threadId },
        { text: prefix + chunk, threadId },
      );
      if (result.success) lastMsgId = result.messageId;
    }
    return { messageId: lastMsgId, botFallback: true };
  }

  /**
   * Auto-thread overflow for messages exceeding Discord's 2000-char limit.
   *
   * Posts a short teaser in the channel, creates a thread from it, then
   * delivers the full content inside the thread — all with agent identity.
   */
  async postWithThreadOverflow(
    channelId: string,
    text: string,
    agentName: string,
  ): Promise<ActionResult> {
    const identity = getAgentIdentity(agentName);
    const personaName = `${identity.emoji} ${identity.name}`;
    logger.info('Message exceeds limit, using thread overflow', {
      channelId,
      agentName,
      textLength: text.length,
    });

    const teaserContent =
      `📋 **Agent Report** • ${personaName}\n\n` +
      `Full output posted in thread below.\n` +
      `**Preview:** ${text.substring(0, 200).replace(/\n/g, ' ')}…`;

    // Dedup + rate limit the teaser (counts as one channel post)
    if (await isDuplicate(channelId, teaserContent, this.redis)) {
      return { success: true, data: { suppressed: true, reason: 'duplicate_within_window' } };
    }
    const rateLimitReason = await checkChannelRateLimits(agentName, channelId, this.redis);
    if (rateLimitReason) {
      logger.info('Discord overflow suppressed (rate limited)', {
        channelId,
        agentName,
        reason: rateLimitReason,
      });
      return { success: true, data: { suppressed: true, reason: 'rate_limited', detail: rateLimitReason } };
    }

    // Step 1: Post short teaser to channel
    try { await this.webhookManager.init(); } catch { /* ignore */ }
    const webhook = this.webhookManager.getWebhookForChannel(channelId);
    let parentMessageId: string | undefined;

    if (webhook) {
      try {
        const sendOptions: Record<string, unknown> = { content: teaserContent, username: personaName };
        if (identity.avatarUrl) sendOptions.avatarURL = identity.avatarUrl;
        const msg = await webhook.send(sendOptions);
        parentMessageId = msg.id;
      } catch (err) {
        logger.warn('Webhook overflow teaser failed', {
          error: err instanceof Error ? err.message : String(err),
          channelId,
          agentName,
        });
      }
    }

    if (!parentMessageId) {
      // Bot fallback for teaser — better APP tag than no content
      const result = await this.adapter.send(
        { channelId },
        { text: `**${personaName}**\n${teaserContent}` },
      );
      if (result.success) parentMessageId = result.messageId;
    }

    if (!parentMessageId) {
      return { success: false, error: 'Failed to post overflow teaser to channel' };
    }

    // Step 2: Create thread from the teaser (create-first)
    let threadId: string;
    try {
      if (typeof this.adapter.createThread !== 'function') {
        throw new Error('Adapter does not support thread creation');
      }
      const threadRef = await this.adapter.createThread(
        { channelId, messageId: parentMessageId },
        `${personaName} — Full Report`,
      );
      threadId = threadRef.threadId;
    } catch (err) {
      logger.warn('Failed to create overflow thread', {
        error: err instanceof Error ? err.message : String(err),
        channelId,
        parentMessageId,
        agentName,
      });
      // Teaser was posted; thread creation failed — partial success
      return {
        success: true,
        data: { messageId: parentMessageId, channelId, agentName, threadCreationFailed: true },
      };
    }

    // Step 3: Post full content in thread
    const threadResult = await this.sendToThreadWithFallback({
      channelId,
      threadId,
      text,
      agentName,
    });

    return {
      success: true,
      data: {
        messageId: parentMessageId,
        channelId,
        threadId,
        agentName,
        botFallback: threadResult.botFallback,
      },
    };
  }
}
