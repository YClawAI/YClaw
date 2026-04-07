import { Redis } from 'ioredis';
import { createLogger } from './logging/logger.js';

const logger = createLogger('fleet-guard');

export class FleetGuard {
  private paused = false;
  private redis: Redis;
  private sub: Redis;

  constructor(redisUrl: string) {
    this.redis = new Redis(redisUrl, { maxRetriesPerRequest: 1, lazyConnect: true });
    this.sub = new Redis(redisUrl, { maxRetriesPerRequest: 1, lazyConnect: true });

    this.redis.on('error', () => { /* suppress — callers check canExecute() */ });
    this.sub.on('error', () => { /* suppress */ });
  }

  async initialize(): Promise<void> {
    await this.redis.connect();
    await this.sub.connect();

    // Check current state on startup
    const status = await this.redis.get('fleet:status');
    this.paused = status === 'paused';
    logger.info('Fleet guard initialized', { paused: this.paused });

    // Subscribe for real-time changes
    await this.sub.subscribe('fleet:status');
    this.sub.on('message', (_channel: string, message: string) => {
      try {
        const data = JSON.parse(message) as { status?: string };
        this.paused = data.status === 'paused';
      } catch {
        // raw string fallback
        this.paused = message === 'paused';
      }
      logger.info('Fleet status changed', { paused: this.paused });
    });
  }

  /**
   * Check before starting any new task.
   * Returns true if fleet is active and tasks can run.
   */
  canExecute(): boolean {
    return !this.paused;
  }

  isPaused(): boolean {
    return this.paused;
  }

  async shutdown(): Promise<void> {
    await this.sub.unsubscribe('fleet:status');
    await this.sub.quit();
    await this.redis.quit();
  }
}
