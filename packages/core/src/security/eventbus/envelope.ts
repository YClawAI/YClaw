/**
 * Secure Event Envelope — HMAC-SHA256 signed event format.
 *
 * All inter-agent events MUST use this envelope. The signature covers
 * ALL fields (including payload) to prevent payload tampering.
 *
 * Addresses: Unauthenticated event forgery leading to prompt injection
 * (March 26 and April 2, 2026 incidents).
 */

import { createHmac, randomUUID, randomBytes, timingSafeEqual } from 'crypto';

export interface EventEnvelope {
  id: string;
  type: string;
  source: string;
  subject?: string;
  timestamp: string;
  nonce: string;
  schemaVersion: string;
  payload: Record<string, unknown>;
  auth: {
    alg: string;
    keyId: string;
    sig: string;
  };
}

/**
 * Canonical JSON serialization for signing.
 * Recursively sorted keys, no whitespace — deterministic across implementations.
 *
 * CRITICAL: `undefined` is normalized to `null` because JSON.stringify drops
 * undefined object properties and converts undefined array elements to null.
 * Without this, sign() and verify() after JSON transport would produce
 * different canonical forms, creating self-invalidating signatures.
 */
function canonicalize(obj: unknown): string {
  if (obj === undefined || obj === null) return 'null';
  if (typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) {
    return '[' + obj.map(item => canonicalize(item)).join(',') + ']';
  }
  const record = obj as Record<string, unknown>;
  const sorted = Object.keys(record).sort();
  // Skip keys with undefined values (matches JSON.stringify behavior)
  const entries = sorted
    .filter(key => record[key] !== undefined)
    .map(key => JSON.stringify(key) + ':' + canonicalize(record[key]));
  return '{' + entries.join(',') + '}';
}

/**
 * Create the signable portion of an envelope (everything except auth).
 */
function signableContent(envelope: Omit<EventEnvelope, 'auth'>): string {
  const fields: Record<string, unknown> = {
    id: envelope.id,
    nonce: envelope.nonce,
    payload: envelope.payload,
    schemaVersion: envelope.schemaVersion,
    source: envelope.source,
    subject: envelope.subject ?? null,
    timestamp: envelope.timestamp,
    type: envelope.type,
  };
  return canonicalize(fields);
}

/**
 * Sign an event envelope with HMAC-SHA256.
 */
export function signEvent(
  type: string,
  source: string,
  payload: Record<string, unknown>,
  secret: Buffer,
  keyId: string,
  subject?: string,
): EventEnvelope {
  const partial: Omit<EventEnvelope, 'auth'> = {
    id: randomUUID(),
    type,
    source,
    subject,
    timestamp: new Date().toISOString(),
    nonce: randomBytes(16).toString('hex'),
    schemaVersion: '1.0',
    payload,
  };

  const content = signableContent(partial);
  const sig = createHmac('sha256', secret).update(content).digest('base64url');

  return {
    ...partial,
    auth: { alg: 'hmac-sha256', keyId, sig },
  };
}

/**
 * Verify an event envelope's HMAC-SHA256 signature.
 * Uses constant-time comparison to prevent timing attacks.
 */
export function verifyEvent(envelope: EventEnvelope, secret: Buffer): boolean {
  const { auth, ...rest } = envelope;
  if (auth.alg !== 'hmac-sha256') return false;

  const content = signableContent(rest);
  // Compare as Buffers to avoid string-length vs byte-length mismatch.
  // Non-ASCII sig strings could match string length but differ in byte length,
  // causing timingSafeEqual to throw RangeError instead of returning false.
  const expectedBuf = createHmac('sha256', secret).update(content).digest();
  let sigBuf: Buffer;
  try {
    sigBuf = Buffer.from(auth.sig, 'base64url');
  } catch {
    return false; // Malformed base64url
  }

  if (expectedBuf.length !== sigBuf.length) return false;
  return timingSafeEqual(expectedBuf, sigBuf);
}
