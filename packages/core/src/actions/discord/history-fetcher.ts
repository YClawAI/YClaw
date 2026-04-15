/**
 * History-fetch handlers for DiscordExecutor.
 *
 * Extracted from executor.ts to keep the executor under 200 lines.
 * Handles:
 *   - discord:get_channel_history — fetch recent messages from a channel
 *   - discord:get_thread          — fetch all replies in a thread
 */

import type { ActionResult } from '../types.js';
import type { DiscordChannelAdapter } from '../../adapters/channels/DiscordChannelAdapter.js';
import { createLogger } from '../../logging/logger.js';

import { resolveChannelId } from './channel-resolver.js';
import { DEFAULT_HISTORY_LIMIT, MAX_HISTORY_LIMIT } from './types.js';

const logger = createLogger('discord-executor');

// ─── discord:get_channel_history ─────────────────────────────────────────────

export async function getChannelHistory(
  params: Record<string, unknown>,
  adapter: DiscordChannelAdapter,
): Promise<ActionResult> {
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
    const messages = await adapter.fetchChannelHistory(channelId, limit);
    return { success: true, data: { channel: channelInput, channelId, messages } };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('Failed to fetch Discord channel history', { channelId, error: msg });
    return { success: false, error: `Failed to fetch channel history: ${msg}` };
  }
}

// ─── discord:get_thread ──────────────────────────────────────────────────────

export async function getThread(
  params: Record<string, unknown>,
  adapter: DiscordChannelAdapter,
): Promise<ActionResult> {
  const threadId = params.threadId as string | undefined;
  const limit = typeof params.limit === 'number'
    ? Math.min(Math.max(params.limit, 1), MAX_HISTORY_LIMIT)
    : DEFAULT_HISTORY_LIMIT;

  if (!threadId) {
    return { success: false, error: 'Missing required parameter: threadId' };
  }

  try {
    const messages = await adapter.fetchThreadReplies(threadId, limit);
    return { success: true, data: { threadId, messages } };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('Failed to fetch Discord thread replies', { threadId, error: msg });
    return { success: false, error: `Failed to fetch thread: ${msg}` };
  }
}
