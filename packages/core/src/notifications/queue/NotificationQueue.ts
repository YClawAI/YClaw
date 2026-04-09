/**
 * NotificationQueue — Rate-limited delivery queue for notifications.
 *
 * Discord rate limits: 5 requests per 5 seconds per webhook.
 * We target 1 request per second per channel to stay well under limits.
 *
 * Each channel key gets its own serial queue. Requests are processed
 * one at a time per channel with configurable interval between sends.
 *
 * Uses a simple internal queue instead of p-queue to avoid an extra
 * dependency. The semantics are the same: serial execution per key
 * with interval spacing.
 */

import { createLogger } from '../../logging/logger.js';

const log = createLogger('notification-queue');

const DEFAULT_INTERVAL_MS = 1000; // 1 request per second per channel

interface QueueEntry {
  fn: () => Promise<void>;
}

export class NotificationQueue {
  private readonly queues = new Map<string, QueueEntry[]>();
  private readonly processing = new Set<string>();
  private readonly intervalMs: number;

  constructor(intervalMs: number = DEFAULT_INTERVAL_MS) {
    this.intervalMs = intervalMs;
  }

  async enqueue(channelKey: string, fn: () => Promise<void>): Promise<void> {
    let queue = this.queues.get(channelKey);
    if (!queue) {
      queue = [];
      this.queues.set(channelKey, queue);
    }
    queue.push({ fn });

    if (!this.processing.has(channelKey)) {
      void this.processQueue(channelKey);
    }
  }

  /** Current queue depth across all channels. */
  get depth(): number {
    let total = 0;
    for (const q of this.queues.values()) {
      total += q.length;
    }
    return total;
  }

  private async processQueue(channelKey: string): Promise<void> {
    this.processing.add(channelKey);
    const queue = this.queues.get(channelKey);

    while (queue && queue.length > 0) {
      const entry = queue.shift()!;
      try {
        await entry.fn();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // Check for rate limit (Discord 429)
        if (msg.includes('429') || msg.includes('rate limit')) {
          log.warn('Rate limited, backing off', { channelKey });
          await sleep(5000);
          // Retry once
          try {
            await entry.fn();
          } catch (retryErr) {
            const retryMsg = retryErr instanceof Error ? retryErr.message : String(retryErr);
            log.error('Notification delivery failed after retry', {
              channelKey, error: retryMsg,
            });
          }
        } else {
          log.error('Notification delivery failed', { channelKey, error: msg });
        }
      }
      // Rate limit spacing between sends
      if (queue.length > 0) {
        await sleep(this.intervalMs);
      }
    }

    this.processing.delete(channelKey);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
