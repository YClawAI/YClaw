/**
 * Event Bus Authentication Module
 *
 * HMAC-SHA256 signed envelopes with 6-stage validation middleware.
 * Addresses unauthenticated event forgery → prompt injection attacks.
 */

export { signEvent, verifyEvent, type EventEnvelope } from './envelope.js';
export { deriveAgentKey, KeyResolver, type DerivedKey } from './keys.js';
export {
  validateEvent,
  type ReplayStore,
  type EventAuditLogger,
} from './middleware.js';
export {
  SchemaRegistry,
  createDefaultSchemaRegistry,
  reviewerFlaggedSchema,
  reviewerApprovedSchema,
  deployExecuteSchema,
  safetyModifySchema,
} from './schemas.js';
export { loadEventPolicy, type EventPolicy, type SourcePolicy } from './policy.js';
export { projectToAgentContext, type SafeEventContext } from './projection.js';
export { SecurePublisher, type PublishClient } from './publisher.js';
export { EventBusError, type EventBusErrorCode } from './errors.js';
