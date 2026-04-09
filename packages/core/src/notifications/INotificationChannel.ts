/**
 * INotificationChannel — Interface for notification-layer channel adapters.
 *
 * This is the notification-specific channel contract. It wraps the lower-level
 * IChannel (messaging infrastructure) with notification semantics: it accepts
 * NotificationEvents and produces PublishResults.
 *
 * Each platform (Slack, Discord) implements this interface. The
 * NotificationRouter broadcasts events to all registered channels.
 */

import type { NotificationEvent, PublishResult } from './types.js';

export interface INotificationChannel {
  /** Platform identifier (e.g., 'slack', 'discord'). */
  readonly platform: string;

  /** Whether this channel is enabled and ready to send. */
  isEnabled(): boolean;

  /** Send a notification event. Returns a publish result on success. */
  send(event: NotificationEvent): Promise<PublishResult>;

  /** Update an existing message (for evolving events like CI pending→success). */
  update?(messageRef: string, event: NotificationEvent): Promise<void>;

  /** Health check — returns true if the channel can accept messages. */
  healthy(): boolean;
}
