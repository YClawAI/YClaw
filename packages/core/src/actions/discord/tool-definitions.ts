/**
 * Tool definitions for DiscordExecutor.
 *
 * Extracted from executor.ts to keep the executor under 200 lines.
 */

import type { ToolDefinition } from '../../config/schema.js';
import { DEFAULT_HISTORY_LIMIT } from './types.js';

export const DISCORD_TOOL_DEFAULTS: Record<string, Record<string, unknown>> = {
  'discord:get_channel_history': { limit: DEFAULT_HISTORY_LIMIT },
  'discord:get_thread': { limit: DEFAULT_HISTORY_LIMIT },
};

export function getDiscordToolDefinitions(): ToolDefinition[] {
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
