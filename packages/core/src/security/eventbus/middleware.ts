/**
 * Event Bus Validation Middleware — 6-stage pipeline.
 *
 * Every received event passes through all stages in order.
 * Any failure = event rejected + audit logged.
 *
 * Stages:
 *   1. Envelope Parsing & Size Check
 *   2. Signature Verification
 *   3. Freshness & Replay Protection
 *   4. Source Authorization Policy
 *   5. Schema Validation
 *   6. Safe LLM Context Projection
 */

import type { EventEnvelope } from './envelope.js';
import { verifyEvent } from './envelope.js';
import type { KeyResolver } from './keys.js';
import type { EventPolicy } from './policy.js';
import type { SchemaRegistry } from './schemas.js';
import { type SafeEventContext, projectToAgentContext } from './projection.js';
import { EventBusError } from './errors.js';

/** Redis-like client interface for replay detection */
export interface ReplayStore {
  set(key: string, value: string, mode: 'EX', ttl: number, flag: 'NX'): Promise<string | null>;
}

/** Audit logger interface */
export interface EventAuditLogger {
  log(entry: Record<string, unknown>): void;
}

const MAX_EVENT_SIZE = 64 * 1024; // 64KB

// --- Stage 1: Envelope Parsing & Size Check ---

function validateEnvelope(raw: string): EventEnvelope {
  if (raw.length > MAX_EVENT_SIZE) {
    throw new EventBusError('EVENT_TOO_LARGE', `Event exceeds ${MAX_EVENT_SIZE} bytes`);
  }

  const parsed = JSON.parse(raw) as Record<string, unknown>;

  // Required field presence check
  const required = ['id', 'type', 'source', 'timestamp', 'nonce', 'schemaVersion', 'payload', 'auth'];
  for (const field of required) {
    if (!(field in parsed)) {
      throw new EventBusError('MISSING_FIELD', `Missing required field: ${field}`);
    }
  }

  // Type validation — prevent NaN/undefined from slipping through the cast
  if (typeof parsed['id'] !== 'string') {
    throw new EventBusError('MISSING_FIELD', 'Field "id" must be a string');
  }
  if (typeof parsed['type'] !== 'string') {
    throw new EventBusError('MISSING_FIELD', 'Field "type" must be a string');
  }
  if (typeof parsed['source'] !== 'string') {
    throw new EventBusError('MISSING_FIELD', 'Field "source" must be a string');
  }
  if (typeof parsed['nonce'] !== 'string') {
    throw new EventBusError('MISSING_FIELD', 'Field "nonce" must be a string');
  }
  if (typeof parsed['schemaVersion'] !== 'string') {
    throw new EventBusError('MISSING_FIELD', 'Field "schemaVersion" must be a string');
  }
  if (typeof parsed['payload'] !== 'object' || parsed['payload'] === null || Array.isArray(parsed['payload'])) {
    throw new EventBusError('MISSING_FIELD', 'Field "payload" must be a non-null object');
  }

  // Timestamp validation — reject non-ISO timestamps that would produce NaN
  if (typeof parsed['timestamp'] !== 'string') {
    throw new EventBusError('MISSING_FIELD', 'Field "timestamp" must be a string');
  }
  const ts = new Date(parsed['timestamp'] as string).getTime();
  if (Number.isNaN(ts)) {
    throw new EventBusError('MISSING_FIELD', 'Field "timestamp" is not a valid ISO 8601 date');
  }

  // Auth sub-fields type validation
  const auth = parsed['auth'] as Record<string, unknown> | undefined;
  if (typeof auth !== 'object' || auth === null) {
    throw new EventBusError('INVALID_AUTH', 'Auth block must be an object');
  }
  if (typeof auth['alg'] !== 'string' || typeof auth['keyId'] !== 'string' || typeof auth['sig'] !== 'string') {
    throw new EventBusError('INVALID_AUTH', 'Incomplete or malformed auth block');
  }

  return parsed as unknown as EventEnvelope;
}

// --- Stage 2: Signature Verification ---

function verifySignature(envelope: EventEnvelope, keyResolver: KeyResolver): void {
  const secret = keyResolver.resolve(envelope.auth.keyId);
  if (!secret) {
    throw new EventBusError('UNKNOWN_KEY', `Unknown key ID: ${envelope.auth.keyId}`);
  }

  if (!verifyEvent(envelope, secret)) {
    throw new EventBusError('INVALID_SIGNATURE', `Signature verification failed for ${envelope.source}`);
  }
}

// --- Stage 3: Freshness & Replay Protection ---

async function checkFreshness(
  envelope: EventEnvelope,
  replayStore: ReplayStore,
  policy: EventPolicy,
): Promise<void> {
  const maxAgeMs = policy.replay.maxAgeSeconds * 1000;
  const maxSkewMs = policy.replay.maxClockSkewSeconds * 1000;
  const cacheTtl = policy.replay.cacheTtlSeconds;

  const eventTime = new Date(envelope.timestamp).getTime();
  const now = Date.now();
  const age = now - eventTime;

  if (eventTime > now + maxSkewMs) {
    throw new EventBusError('FUTURE_EVENT', `Event timestamp is ${-age}ms in the future`);
  }

  if (age > maxAgeMs) {
    throw new EventBusError('EXPIRED_EVENT', `Event is ${age}ms old (max: ${maxAgeMs}ms)`);
  }

  // Replay detection: check event ID
  const idKey = `yclaw:replay:id:${envelope.id}`;
  const wasSet = await replayStore.set(idKey, '1', 'EX', cacheTtl, 'NX');
  if (!wasSet) {
    throw new EventBusError('REPLAY_DETECTED', `Duplicate event ID: ${envelope.id}`);
  }

  // Replay detection: check source+nonce pair
  const nonceKey = `yclaw:replay:nonce:${envelope.source}:${envelope.nonce}`;
  const nonceSet = await replayStore.set(nonceKey, '1', 'EX', cacheTtl, 'NX');
  if (!nonceSet) {
    throw new EventBusError('NONCE_REPLAY', `Duplicate nonce from ${envelope.source}`);
  }
}

// --- Stage 4: Source Authorization ---

function authorizeSource(envelope: EventEnvelope, policy: EventPolicy): void {
  const sourceConfig = policy.sources[envelope.source];

  if (!sourceConfig) {
    throw new EventBusError('UNKNOWN_SOURCE', `Unregistered source: ${envelope.source}`);
  }

  const typeAllowed = sourceConfig.allowedEventTypes.some(pattern => {
    if (pattern.endsWith(':*')) {
      return envelope.type.startsWith(pattern.slice(0, -1));
    }
    return envelope.type === pattern;
  });

  if (!typeAllowed) {
    throw new EventBusError(
      'UNAUTHORIZED_EVENT_TYPE',
      `${envelope.source} is not authorized to emit ${envelope.type}`,
    );
  }
}

// --- Stage 5: Schema Validation ---

function validateSchema(
  envelope: EventEnvelope,
  schemaRegistry: SchemaRegistry,
  policy: EventPolicy,
): void {
  const schema = schemaRegistry.get(envelope.type);

  if (!schema) {
    throw new EventBusError('NO_SCHEMA', `No schema registered for event type: ${envelope.type}`);
  }

  const result = schema.safeParse(envelope.payload);
  if (!result.success) {
    const issues = result.error.issues.map(i => i.message).join(', ');
    throw new EventBusError('SCHEMA_VIOLATION', `Payload validation failed: ${issues}`);
  }

  // Check globally denied fields (defense in depth)
  for (const field of policy.globalDeniedFields) {
    if (field in envelope.payload) {
      throw new EventBusError('DENIED_FIELD', `Payload contains globally denied field: ${field}`);
    }
  }
}

// --- Full Pipeline ---

/**
 * The complete validation pipeline. Every received event passes through
 * all stages in order. Any failure = event rejected + audit logged.
 */
export async function validateEvent(
  raw: string,
  keyResolver: KeyResolver,
  policy: EventPolicy,
  schemaRegistry: SchemaRegistry,
  replayStore: ReplayStore,
  auditLogger: EventAuditLogger,
): Promise<SafeEventContext> {
  try {
    // Stage 1: Parse
    const envelope = validateEnvelope(raw);

    // Stage 2: Signature
    verifySignature(envelope, keyResolver);

    // Stage 3: Freshness & replay
    await checkFreshness(envelope, replayStore, policy);

    // Stage 4: Authorization
    authorizeSource(envelope, policy);

    // Stage 5: Schema
    validateSchema(envelope, schemaRegistry, policy);

    // Stage 6: Safe projection
    const context = projectToAgentContext(envelope);

    auditLogger.log({
      event: 'eventbus.verified',
      eventId: envelope.id,
      type: envelope.type,
      source: envelope.source,
    });

    return context;
  } catch (err) {
    // Audit-log ALL rejections, not just typed EventBusError.
    // Untyped errors (RangeError, SyntaxError) from malformed input
    // must also be captured for forensics.
    if (err instanceof EventBusError) {
      auditLogger.log({
        event: 'eventbus.rejected',
        reason: err.code,
        message: err.message,
        rawPayload: raw.slice(0, 4096),
      });
    } else {
      auditLogger.log({
        event: 'eventbus.rejected',
        reason: 'INTERNAL_ERROR',
        message: err instanceof Error ? err.message : String(err),
        rawPayload: raw.slice(0, 4096),
      });
    }
    throw err;
  }
}
