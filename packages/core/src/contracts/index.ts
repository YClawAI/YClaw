/**
 * Shared Contracts — canonical Zod-validated types for the YClaw Agents platform.
 *
 * Phase 0 of the unified architecture upgrade. These contracts are the
 * single source of truth for session tracking, run records, event envelopes,
 * approval workflows, and thread key generation.
 *
 * All subsequent phases import from this barrel rather than defining their own
 * local versions of these types.
 */

export {
  SessionStateSchema,
  type SessionState,
  HarnessTypeSchema,
  type HarnessType,
  SessionTokenUsageSchema,
  type SessionTokenUsage,
  SessionRecordSchema,
  type SessionRecord,
} from './session.js';

export {
  RunStatusSchema,
  type RunStatus,
  RunCostSchema,
  type RunCost,
  RunRecordSchema,
  type RunRecord,
} from './run.js';

export {
  EventEnvelopeSchema,
  type EventEnvelope,
} from './event-envelope.js';

export {
  ApprovalTypeSchema,
  type ApprovalType,
  ApprovalStatusSchema,
  type ApprovalStatus,
  ApprovalSchema,
  type Approval,
} from './approvals.js';

export {
  ThreadKeyInputSchema,
  type ThreadKeyInput,
  computeThreadKey,
} from './thread-key.js';
