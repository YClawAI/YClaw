/**
 * NotificationRouter — Fan-out broadcaster for notification events.
 *
 * Accepts NotificationEvents and broadcasts them to all registered
 * INotificationChannel implementations. Uses Promise.allSettled so
 * one platform failure doesn't block the others.
 */

import type { INotificationChannel } from './INotificationChannel.js';
import type { NotificationEvent } from './types.js';
import { createLogger } from '../logging/logger.js';

const log = createLogger('notification-router');

export class NotificationRouter {
  private readonly channels: INotificationChannel[] = [];

  register(channel: INotificationChannel): void {
    this.channels.push(channel);
    log.info('Notification channel registered', { platform: channel.platform });
  }

  async broadcast(event: NotificationEvent): Promise<void> {
    const enabled = this.channels.filter(ch => ch.isEnabled());
    if (enabled.length === 0) return;

    const results = await Promise.allSettled(
      enabled.map(ch => ch.send(event)),
    );

    for (let i = 0; i < results.length; i++) {
      const result = results[i]!;
      if (result.status === 'rejected') {
        const reason = result.reason instanceof Error
          ? result.reason.message
          : String(result.reason);
        log.error('Notification delivery failed', {
          platform: enabled[i]!.platform,
          kind: event.kind,
          title: event.title,
          error: reason,
        });
      }
    }
  }

  /** Number of registered channels. */
  get size(): number {
    return this.channels.length;
  }
}
