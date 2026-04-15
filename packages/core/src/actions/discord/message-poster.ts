/**
 * Message posting handlers for DiscordExecutor.
 *
 * Extracted from executor.ts to keep the executor under 200 lines.
 * Handles:
 *   - discord:message  — post to a channel with webhook identity + overflow
 *   - discord:alert    — post a formatted alert embed with severity emoji
 */

import type { Redis } from 'ioredis';
import type { ActionResult } from '../types.js';
import type { DiscordChannelAdapter } from '../../adapters/channels/DiscordChannelAdapter.js';
import { createLogger } from '../../logging/logger.js';
import { getAgentIdentity } from '../../notifications/AgentRegistry.js';
import { getChannelForAgent } from '../../utils/channel-routing.js';

import { resolveChannelId } from './channel-resolver.js';
import { isDuplicate, checkChannelRateLimits } from './rate-limiter.js';
import type { WebhookManager } from './webhook-manager.js';
import type { ThreadManager } from './thread-manager.js';
import { PUBLIC_MESSAGE_MAX_LEN } from './types.js';

const logger = createLogger('discord-executor');

/** Agents that may always target any channel (bypass department enforcement). */
const SUPPORT_AGENTS = ['keeper', 'guide'];

const SEVERITY_EMOJI: Record<string, string> = {
  info: 'ℹ️', warning: '⚠️', error: '❌', critical: '🚨', success: '✅',
};

// ─── discord:message ─────────────────────────────────────────────────────────

export async function postMessage(
  params: Record<string, unknown>,
  adapter: DiscordChannelAdapter,
  redis: Redis | null,
  webhookManager: WebhookManager,
  threadManager: ThreadManager,
): Promise<ActionResult> {
  let channelInput = params.channel as string | undefined;
  const text = params.text as string | undefined;
  const replyToMessageId = params.replyToMessageId as string | undefined;
  const agentName = (params.agentName as string | undefined) ?? 'system';

  // Belt-and-suspenders: enforce department channel routing.
  if (agentName && agentName !== 'system' && !SUPPORT_AGENTS.includes(agentName)) {
    const deptChannel = getChannelForAgent(agentName, 'discord');
    if (deptChannel && channelInput !== deptChannel) {
      logger.info('[discord-executor-enforcement] overriding channel', {
        agentName, from: channelInput, to: deptChannel,
      });
      channelInput = deptChannel;
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
    return threadManager.postWithThreadOverflow(channelId, text, agentName);
  }

  if (await isDuplicate(channelId, text, redis)) {
    logger.info('Discord message suppressed (duplicate)', { channelId, agentName });
    return { success: true, data: { suppressed: true, reason: 'duplicate_within_window' } };
  }

  const rateLimitReason = await checkChannelRateLimits(agentName, channelId, redis);
  if (rateLimitReason) {
    logger.info('Discord message suppressed (rate limited)', { channelId, agentName, reason: rateLimitReason });
    return { success: true, data: { suppressed: true, reason: 'rate_limited', detail: rateLimitReason } };
  }

  const identity = getAgentIdentity(agentName);
  logger.info('Posting Discord message', { channelId, agentName, textLength: text.length });

  // Try webhook path for agent identity
  try { await webhookManager.init(); } catch (err) {
    logger.warn('Webhook init failed, will use bot fallback', { error: err instanceof Error ? err.message : String(err) });
  }
  const webhook = webhookManager.getWebhookForChannel(channelId);
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
  const result = await adapter.send(
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

// ─── discord:alert ───────────────────────────────────────────────────────────

export async function postAlert(
  params: Record<string, unknown>,
  adapter: DiscordChannelAdapter,
  redis: Redis | null,
  webhookManager: WebhookManager,
): Promise<ActionResult> {
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

  if (await isDuplicate(channelId, text, redis)) {
    return { success: true, data: { suppressed: true, reason: 'duplicate_within_window' } };
  }

  const rateLimitReason = await checkChannelRateLimits(agentName, channelId, redis);
  if (rateLimitReason) {
    return { success: true, data: { suppressed: true, reason: 'rate_limited', detail: rateLimitReason } };
  }

  const emoji = SEVERITY_EMOJI[severity] ?? '⚠️';
  const header = `${emoji} **${title ?? `${severity.toUpperCase()} alert`}**`;
  const formatted = `${header}\n${text}`;

  const identity = getAgentIdentity(agentName);
  try { await webhookManager.init(); } catch (err) {
    logger.warn('Webhook init failed, will use bot fallback', { error: err instanceof Error ? err.message : String(err) });
  }
  const alertWebhook = webhookManager.getWebhookForChannel(channelId);
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
  const result = await adapter.send({ channelId }, { text: prefix + formatted });

  if (!result.success) {
    return { success: false, error: `Failed to post alert: ${result.error ?? 'unknown error'}` };
  }
  return { success: true, data: { messageId: result.messageId, channelId, severity, agentName } };
}
