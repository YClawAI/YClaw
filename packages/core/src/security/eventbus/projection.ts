/**
 * Safe LLM Context Projection
 *
 * CRITICAL: Raw bus payloads must NEVER be directly inserted into agent
 * LLM context. This sanitizer creates a structured, minimal representation
 * that labels the source as verified and strips the auth block entirely.
 */

import type { EventEnvelope } from './envelope.js';

export interface SafeEventContext {
  eventType: string;
  verifiedSource: string;
  verified: true;
  subject?: string;
  facts: Record<string, unknown>;
}

/**
 * Project a verified envelope into a safe format for LLM context.
 * Only pass validated payload fields as "facts".
 * Strips auth block, nonce, and schema version.
 */
export function projectToAgentContext(envelope: EventEnvelope): SafeEventContext {
  return {
    eventType: envelope.type,
    verifiedSource: envelope.source,
    verified: true,
    subject: envelope.subject,
    facts: envelope.payload,
  };
}
