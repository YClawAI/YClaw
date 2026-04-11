import { Client, GatewayIntentBits, TextChannel, ThreadChannel, ChannelType, MessageReaction, User, PartialUser, PartialMessageReaction } from 'discord.js';
import { z } from 'zod';
import { ActionExecutor } from '../types/action.js';
import { getChannelForDepartment, getChannelForAgent } from '../utils/channel-routing.js';

// ─── Discord Client Singleton ───────────────────────────────────────────────

let client: Client | null = null;
let isReady = false;

function getClient(): Client {
  if (!client) {
    const token = process.env.DISCORD_BOT_TOKEN;
    if (!token) {
      throw new Error('Discord bot not initialized: missing DISCORD_BOT_TOKEN');
    }

    client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMessageReactions,
      ],
    });

    client.once('ready', () => {
      console.log(`Discord bot ready as ${client?.user?.tag}`);
      isReady = true;
    });

    client.login(token);
  }
  return client;
}

// ─── Channel Resolution ─────────────────────────────────────────────────────

/**
 * Resolve a channel name to a Discord channel ID.
 * Supports:
 * - Direct snowflake IDs (e.g., "1234567890123456789")
 * - Department names (e.g., "development", "marketing") → resolved via channel-routing.ts
 * - Legacy aliases for backward compatibility
 */
function resolveChannelId(channelName: string): string | undefined {
  // Direct snowflake ID
  if (/^\d{17,19}$/.test(channelName)) {
    return channelName;
  }

  // Department name → use channel-routing.ts
  const departmentChannelId = getChannelForDepartment(channelName as any, 'discord');
  if (departmentChannelId) {
    return departmentChannelId;
  }

  // Legacy aliases for backward compatibility
  const legacyAliases: Record<string, string> = {
    general: process.env.DISCORD_CHANNEL_GENERAL || '',
    alerts: process.env.DISCORD_CHANNEL_ALERTS || '',
    executive: process.env.DISCORD_CHANNEL_EXECUTIVE || '',
    development: process.env.DISCORD_CHANNEL_DEVELOPMENT || '',
    marketing: process.env.DISCORD_CHANNEL_MARKETING || '',
    operations: process.env.DISCORD_CHANNEL_OPERATIONS || '',
    finance: process.env.DISCORD_CHANNEL_FINANCE || '',
    support: process.env.DISCORD_CHANNEL_SUPPORT || '',
  };

  const aliasChannelId = legacyAliases[channelName];
  if (aliasChannelId) {
    return aliasChannelId;
  }

  // Fallback to marketing channel if nothing else works
  return process.env.DISCORD_CHANNEL_MARKETING;
}

// ─── Action Schemas ──────────────────────────────────────────────────────────

const MessageSchema = z.object({
  channel: z.string().describe('Channel name or snowflake ID'),
  text: z.string().describe('Message content'),
  threadId: z.string().optional().describe('Thread ID to reply in'),
});

const ThreadReplySchema = z.object({
  threadId: z.string().describe('Thread ID to reply to'),
  text: z.string().describe('Reply content'),
});

const ReactSchema = z.object({
  messageId: z.string().describe('Message ID to react to'),
  channelId: z.string().describe('Channel ID where the message is'),
  emoji: z.string().describe('Emoji to react with (unicode or custom :name:)'),
});

// ─── Action Implementations ─────────────────────────────────────────────────

async function sendMessage(params: z.infer<typeof MessageSchema>) {
  const client = getClient();
  
  if (!isReady) {
    throw new Error('Discord bot not ready yet');
  }

  const channelId = resolveChannelId(params.channel);
  if (!channelId) {
    throw new Error(`Unknown Discord channel: "${params.channel}". Use a name from DISCORD_CHANNELS or a snowflake ID.`);
  }

  const channel = await client.channels.fetch(channelId);
  if (!channel) {
    throw new Error(`Channel not found: ${channelId}`);
  }

  if (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.PublicThread && channel.type !== ChannelType.PrivateThread) {
    throw new Error(`Channel ${channelId} is not a text channel or thread`);
  }

  // Check message length for public channels
  if (channel.type === ChannelType.GuildText && params.text.length > 600) {
    throw new Error('Message exceeds 600 character limit for public channels. Use a thread for longer content.');
  }

  let targetChannel: TextChannel | ThreadChannel = channel as TextChannel | ThreadChannel;

  // If threadId is specified, send to that thread
  if (params.threadId) {
    const thread = await client.channels.fetch(params.threadId);
    if (!thread || (thread.type !== ChannelType.PublicThread && thread.type !== ChannelType.PrivateThread)) {
      throw new Error(`Thread not found or invalid: ${params.threadId}`);
    }
    targetChannel = thread as ThreadChannel;
  }

  const message = await targetChannel.send(params.text);
  return {
    messageId: message.id,
    channelId: targetChannel.id,
    url: message.url,
  };
}

async function replyToThread(params: z.infer<typeof ThreadReplySchema>) {
  const client = getClient();
  
  if (!isReady) {
    throw new Error('Discord bot not ready yet');
  }

  const thread = await client.channels.fetch(params.threadId);
  if (!thread || (thread.type !== ChannelType.PublicThread && thread.type !== ChannelType.PrivateThread)) {
    throw new Error(`Thread not found or invalid: ${params.threadId}`);
  }

  const threadChannel = thread as ThreadChannel;
  const message = await threadChannel.send(params.text);
  
  return {
    messageId: message.id,
    threadId: params.threadId,
    url: message.url,
  };
}

async function addReaction(params: z.infer<typeof ReactSchema>) {
  const client = getClient();
  
  if (!isReady) {
    throw new Error('Discord bot not ready yet');
  }

  const channel = await client.channels.fetch(params.channelId);
  if (!channel || (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.PublicThread && channel.type !== ChannelType.PrivateThread)) {
    throw new Error(`Channel not found or invalid: ${params.channelId}`);
  }

  const textChannel = channel as TextChannel | ThreadChannel;
  const message = await textChannel.messages.fetch(params.messageId);
  
  await message.react(params.emoji);
  
  return {
    messageId: params.messageId,
    channelId: params.channelId,
    emoji: params.emoji,
  };
}

// ─── Action Executor Registration ───────────────────────────────────────────

export const discordActions: Record<string, ActionExecutor> = {
  message: {
    schema: MessageSchema,
    execute: sendMessage,
  },
  thread_reply: {
    schema: ThreadReplySchema,
    execute: replyToThread,
  },
  react: {
    schema: ReactSchema,
    execute: addReaction,
  },
};