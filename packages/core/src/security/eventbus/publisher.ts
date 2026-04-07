/**
 * Secure Event Publisher — drop-in replacement for raw Redis PUBLISH.
 *
 * Agents shouldn't manually construct envelopes. The publisher wraps,
 * signs, and publishes automatically — making unsigned events impossible
 * to create through normal code paths.
 */

import { signEvent } from './envelope.js';
import { deriveAgentKey } from './keys.js';

/** Redis-like client interface for publishing */
export interface PublishClient {
  publish(channel: string, message: string): Promise<number>;
}

/**
 * Secure event publisher.
 *
 * Usage:
 *   const publisher = new SecurePublisher(redis, 'reviewer', masterSecret);
 *   await publisher.publish('reviewer:flagged', { reason: '...', severity: 'high' });
 */
export class SecurePublisher {
  private key: Buffer;
  private keyId: string;
  private source: string;

  constructor(
    private redis: PublishClient,
    agentId: string,
    masterSecret: string,
    version = 1,
  ) {
    this.source = `agent:${agentId}`;
    const derived = deriveAgentKey(masterSecret, agentId, version);
    this.key = derived.key;
    this.keyId = derived.keyId;
  }

  async publish(
    eventType: string,
    payload: Record<string, unknown>,
    subject?: string,
  ): Promise<string> {
    const envelope = signEvent(
      eventType,
      this.source,
      payload,
      this.key,
      this.keyId,
      subject,
    );

    await this.redis.publish(
      `yclaw:events:${eventType}`,
      JSON.stringify(envelope),
    );

    return envelope.id;
  }
}
