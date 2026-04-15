/**
 * Notifications module — Unified multi-platform notification system.
 *
 * Architecture:
 *   Agent Code → coord.* event → ChannelNotifier → event-converter
 *     → NotificationRouter.broadcast(NotificationEvent)
 *       → SlackChannel (SlackRenderer → Block Kit)
 *       → DiscordChannel (DiscordRenderer → Embeds + Webhooks)
 */

// Types
export type {
  NotificationKind,
  Severity,
  Department,
  NotificationEvent,
  PublishResult,
} from './types.js';

// Agent Registry
export { getAgentIdentity } from './AgentRegistry.js';
export type { AgentIdentity } from './AgentRegistry.js';

// Router
export { NotificationRouter } from './NotificationRouter.js';
export type { INotificationChannel } from './INotificationChannel.js';

// Event conversion
export { toNotificationEvent } from './event-converter.js';

// Platform channels
export { DiscordChannel } from './discord/DiscordChannel.js';
export { SlackChannel } from './slack/SlackChannel.js';

// Renderers
export { DiscordRenderer } from './discord/DiscordRenderer.js';
export type { DiscordEmbed } from './discord/DiscordRenderer.js';
export { SlackRenderer } from './slack/SlackRenderer.js';
export type { SlackPayload } from './slack/SlackRenderer.js';

// State
export { ThreadRegistry } from './state/ThreadRegistry.js';
export { MessageRegistry } from './state/MessageRegistry.js';
export type { MessageRef } from './state/MessageRegistry.js';

// Queue
export { NotificationQueue } from './queue/NotificationQueue.js';
