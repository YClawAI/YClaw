import { createHmac, timingSafeEqual } from 'node:crypto';
import type { EventBus } from './event.js';
import { createLogger } from '../logging/logger.js';

const logger = createLogger('slack-webhook');

/** Max event IDs to retain for dedup. */
const MAX_EVENT_CACHE = 1000;

// ─── Types ──────────────────────────────────────────────────────────────────

interface SlackEventPayload {
  type: string;
  token?: string;
  challenge?: string;
  team_id?: string;
  event_id?: string;
  event_time?: number;
  event?: {
    type: string;
    subtype?: string;
    channel: string;
    channel_type?: string;
    user?: string;
    bot_id?: string;
    text?: string;
    ts?: string;
    thread_ts?: string;
    event_ts?: string;
  };
}

export interface SlackWebhookResult {
  processed: boolean;
  event?: string;
  challenge?: string;
}

// ─── Handler ────────────────────────────────────────────────────────────────

/**
 * Receives Slack Events API payloads, verifies signatures, deduplicates,
 * and publishes normalized events to the internal EventBus.
 *
 * Security layers (fail-closed):
 *   1. Signing secret required (no-op if missing)
 *   2. Timestamp validation (reject if > 5 min old, prevents replay)
 *   3. HMAC-SHA256 signature verification
 *   4. Event ID dedup (Slack retries on 5xx)
 *   5. Optional channel allowlist
 */
export class SlackWebhookHandler {
  private readonly signingSecret: string | null;
  private readonly allowedChannels: Set<string> | null;
  private recentEventIds = new Set<string>();

  constructor(private readonly eventBus: EventBus) {
    this.signingSecret = process.env.SLACK_SIGNING_SECRET || null;
    if (!this.signingSecret) {
      logger.warn('SLACK_SIGNING_SECRET not set — Slack webhook disabled');
    }

    // Optional channel allowlist (fail-open if not set)
    const channelIds = process.env.SLACK_ALLOWED_CHANNEL_IDS;
    this.allowedChannels = channelIds
      ? new Set(channelIds.split(',').map(s => s.trim()).filter(Boolean))
      : null;

    logger.info('SlackWebhookHandler initialized', {
      signingSecretSet: !!this.signingSecret,
      allowedChannels: this.allowedChannels?.size ?? 'all',
    });
  }

  // ─── Signature Verification ─────────────────────────────────────────────

  /**
   * Verify Slack request signature using HMAC-SHA256.
   * Returns true if valid, false otherwise.
   */
  verifySignature(rawBody: string, signature: string | undefined, timestamp: string | undefined): boolean {
    if (!this.signingSecret) return false;
    if (!signature || !timestamp) return false;

    // Reject requests older than 5 minutes (replay protection)
    const ts = parseInt(timestamp, 10);
    if (isNaN(ts) || Math.abs(Date.now() / 1000 - ts) > 300) {
      logger.warn('Slack request timestamp too old or invalid', { timestamp });
      return false;
    }

    const sigBasestring = `v0:${timestamp}:${rawBody}`;
    const mySignature = 'v0=' + createHmac('sha256', this.signingSecret)
      .update(sigBasestring)
      .digest('hex');

    // Timing-safe comparison
    try {
      return timingSafeEqual(Buffer.from(mySignature), Buffer.from(signature));
    } catch {
      return false;
    }
  }

  // ─── Webhook Handler ────────────────────────────────────────────────────

  /**
   * Process an incoming Slack Events API payload.
   * Called by the Express route handler after raw body capture.
   */
  async handleWebhook(
    payload: SlackEventPayload,
    rawBody: string,
    signature: string | undefined,
    timestamp: string | undefined,
  ): Promise<SlackWebhookResult> {
    // url_verification is handled at the route level (no signature check needed
    // for the initial handshake), but guard here too
    if (payload.type === 'url_verification') {
      return { processed: false, challenge: payload.challenge };
    }

    // Signature verification (fail-closed)
    if (!this.verifySignature(rawBody, signature, timestamp)) {
      logger.warn('Slack signature verification failed');
      return { processed: false };
    }

    // Only handle event_callback
    if (payload.type !== 'event_callback') {
      logger.info('Ignoring non-event_callback Slack payload', { type: payload.type });
      return { processed: false };
    }

    const event = payload.event;
    if (!event) return { processed: false };

    // Event ID dedup (Slack retries on 5xx)
    const eventId = payload.event_id;
    if (eventId) {
      if (this.recentEventIds.has(eventId)) {
        logger.info('Duplicate Slack event, skipping', { eventId });
        return { processed: false };
      }
      this.recentEventIds.add(eventId);
      if (this.recentEventIds.size > MAX_EVENT_CACHE * 2) {
        const entries = [...this.recentEventIds];
        this.recentEventIds = new Set(entries.slice(-MAX_EVENT_CACHE));
      }
    }

    // Channel allowlist
    if (this.allowedChannels && !this.allowedChannels.has(event.channel)) {
      logger.info('Slack event from non-allowed channel, skipping', {
        channel: event.channel,
      });
      return { processed: false };
    }

    switch (event.type) {
      case 'app_mention':
        return this.handleAppMention(event, eventId);
      case 'message':
        return this.handleMessage(event, eventId);
      default:
        logger.info('Ignoring unhandled Slack event type', { type: event.type });
        return { processed: false };
    }
  }

  // ─── Event Handlers ─────────────────────────────────────────────────────

  private async handleAppMention(
    event: NonNullable<SlackEventPayload['event']>,
    eventId?: string,
  ): Promise<SlackWebhookResult> {
    // Skip bot messages
    if (event.bot_id) return { processed: false };

    const eventPayload = this.buildEventPayload(event, true, eventId);

    logger.info('Publishing slack:app_mention', {
      channel: event.channel,
      user: event.user,
    });

    await this.eventBus.publish('slack', 'app_mention', eventPayload);
    return { processed: true, event: 'slack:app_mention' };
  }

  private async handleMessage(
    event: NonNullable<SlackEventPayload['event']>,
    eventId?: string,
  ): Promise<SlackWebhookResult> {
    // Skip bot messages and subtypes (message_changed, message_deleted, etc.)
    if (event.bot_id || event.subtype) return { processed: false };

    const eventPayload = this.buildEventPayload(event, false, eventId);

    logger.info('Publishing slack:message', {
      channel: event.channel,
      user: event.user,
    });

    await this.eventBus.publish('slack', 'message', eventPayload);
    return { processed: true, event: 'slack:message' };
  }

  private buildEventPayload(
    event: NonNullable<SlackEventPayload['event']>,
    isMention: boolean,
    eventId?: string,
  ): Record<string, unknown> {
    return {
      channel: event.channel,
      channelType: event.channel_type || 'channel',
      user: event.user || 'unknown',
      text: event.text || '',
      ts: event.ts || '',
      threadTs: event.thread_ts,
      isMention,
      eventId: eventId || '',
      timestamp: new Date().toISOString(),
    };
  }
}
