/**
 * Reaction and thread-creation handlers for DiscordExecutor.
 *
 * Extracted from executor.ts to keep the executor under 200 lines.
 * Handles:
 *   - discord:react         — add an emoji reaction to a message
 *   - discord:create_thread — start a thread anchored on a message
 */

import type { ActionResult } from '../types.js';
import type { DiscordChannelAdapter } from '../../adapters/channels/DiscordChannelAdapter.js';
import { createLogger } from '../../logging/logger.js';

import { resolveChannelId } from './channel-resolver.js';

const logger = createLogger('discord-executor');

// ─── discord:react ───────────────────────────────────────────────────────────

export async function react(
  params: Record<string, unknown>,
  adapter: DiscordChannelAdapter,
): Promise<ActionResult> {
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
    if (typeof adapter.react !== 'function') {
      return { success: false, error: 'Discord adapter does not implement react' };
    }
    await adapter.react({ messageId, channelId }, emoji);
    return { success: true, data: { channelId, messageId, emoji } };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('Failed to add Discord reaction', { channelId, messageId, error: msg });
    return { success: false, error: `Failed to react: ${msg}` };
  }
}

// ─── discord:create_thread ───────────────────────────────────────────────────

export async function createThread(
  params: Record<string, unknown>,
  adapter: DiscordChannelAdapter,
): Promise<ActionResult> {
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
    if (typeof adapter.createThread !== 'function') {
      return { success: false, error: 'Discord adapter does not implement createThread' };
    }
    const thread = await adapter.createThread({ messageId, channelId }, name);
    return { success: true, data: { threadId: thread.threadId, channelId: thread.channelId, name } };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('Failed to create Discord thread', { channelId, messageId, error: msg });
    return { success: false, error: `Failed to create thread: ${msg}` };
  }
}
