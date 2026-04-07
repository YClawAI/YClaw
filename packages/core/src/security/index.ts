/**
 * YCLAW Security Module
 *
 * Agent safety guards, circuit breakers, egress controls, audit logging,
 * and event bus authentication (HMAC-SHA256 signed envelopes).
 */

export {
  validateAgentPR,
  PROTECTED_PATHS,
  FORBIDDEN_PATHS,
  SELF_MODIFICATION_PATTERNS,
  type AgentPRValidation,
} from './agent-safety-guard.js';

export {
  AgentCircuitBreaker,
  DEFAULT_CIRCUIT_BREAKER,
  type CircuitBreakerConfig,
  type CircuitState,
} from './circuit-breaker.js';

export {
  AGENT_EGRESS_ALLOWLIST,
  isEgressAllowed,
  type AllowedEndpoint,
} from './egress-allowlist.js';

export {
  createAuditEntry,
  type AuditEntry,
} from './audit-log.js';

// Event Bus Authentication
export {
  signEvent,
  verifyEvent,
  type EventEnvelope,
  deriveAgentKey,
  KeyResolver,
  validateEvent,
  SchemaRegistry,
  createDefaultSchemaRegistry,
  SecurePublisher,
  loadEventPolicy,
  projectToAgentContext,
  EventBusError,
  type EventPolicy,
  type SafeEventContext,
  type EventBusErrorCode,
  type DerivedKey,
  type ReplayStore,
  type EventAuditLogger,
  type PublishClient,
} from './eventbus/index.js';
