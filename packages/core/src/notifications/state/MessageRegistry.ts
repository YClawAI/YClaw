/**
 * MessageRegistry — Redis-backed mapping of correlation keys to message references.
 *
 * Enables updating existing messages instead of posting new ones for events
 * that evolve (CI pending→success, incident open→resolved).
 *
 * TTL: 24 hours.
 */

import type { Redis } from 'ioredis';
import { createLogger } from '../../logging/logger.js';

const log = createLogger('message-registry');

const KEY_PREFIX = 'notif:msg:';
const DEFAULT_TTL_S = 86400; // 24 hours

export interface MessageRef {
  messageId: string;
  channelId: string;
  platform: string;
  createdAt: number;
}

export class MessageRegistry {
  constructor(
    private readonly redis: Redis,
    private readonly ttlSeconds: number = DEFAULT_TTL_S,
  ) {}

  async get(key: string): Promise<MessageRef | null> {
    try {
      const data = await this.redis.get(`${KEY_PREFIX}${key}`);
      if (!data) return null;
      return JSON.parse(data) as MessageRef;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error('MessageRegistry.get failed', { key, error: msg });
      return null;
    }
  }

  async set(key: string, ref: MessageRef): Promise<void> {
    try {
      await this.redis.set(
        `${KEY_PREFIX}${key}`,
        JSON.stringify(ref),
        'EX',
        this.ttlSeconds,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error('MessageRegistry.set failed', { key, error: msg });
    }
  }
}
