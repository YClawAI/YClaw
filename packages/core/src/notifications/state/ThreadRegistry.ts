/**
 * ThreadRegistry — Redis-backed mapping of threadKey to thread IDs.
 *
 * Maps correlation keys (e.g., "pr-123", "incident-INC-42") to platform
 * thread IDs so subsequent events in the same workflow land in the same
 * thread instead of creating new top-level messages.
 *
 * TTL: 48 hours (threads auto-archive anyway).
 */

import type { Redis } from 'ioredis';
import { createLogger } from '../../logging/logger.js';

const log = createLogger('thread-registry');

const KEY_PREFIX = 'notif:thread:';
const DEFAULT_TTL_S = 86400 * 2; // 48 hours

interface ThreadEntry {
  channelId: string;
  threadId: string;
  createdAt: number;
}

export class ThreadRegistry {
  constructor(
    private readonly redis: Redis,
    private readonly ttlSeconds: number = DEFAULT_TTL_S,
  ) {}

  async get(threadKey: string): Promise<string | null> {
    try {
      const data = await this.redis.get(`${KEY_PREFIX}${threadKey}`);
      if (!data) return null;
      const entry = JSON.parse(data) as ThreadEntry;
      return entry.threadId;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error('ThreadRegistry.get failed', { threadKey, error: msg });
      return null;
    }
  }

  async set(
    threadKey: string,
    channelId: string,
    threadId: string,
  ): Promise<void> {
    try {
      const entry: ThreadEntry = {
        channelId,
        threadId,
        createdAt: Date.now(),
      };
      await this.redis.set(
        `${KEY_PREFIX}${threadKey}`,
        JSON.stringify(entry),
        'EX',
        this.ttlSeconds,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error('ThreadRegistry.set failed', { threadKey, error: msg });
    }
  }
}
