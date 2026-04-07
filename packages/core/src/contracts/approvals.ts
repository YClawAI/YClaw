import { z } from 'zod';

// ─── Approval Type ────────────────────────────────────────────────────────────

export const ApprovalTypeSchema = z.enum([
  'config_change',
  'prompt_change',
  'code_change',
  'tool_add',
  'agent_spawn',
  'deploy',
  'external_publish',
]);

export type ApprovalType = z.infer<typeof ApprovalTypeSchema>;

// ─── Approval Status ──────────────────────────────────────────────────────────

export const ApprovalStatusSchema = z.enum([
  'pending',
  'approved',
  'rejected',
  'applied',
  'expired',
]);

export type ApprovalStatus = z.infer<typeof ApprovalStatusSchema>;

// ─── Approval ─────────────────────────────────────────────────────────────────

/**
 * Approval — a proposal-review-apply primitive for agent-initiated changes.
 *
 * Lifecycle: proposed → pending → approved/rejected → applied (or expired).
 * Audit trail is preserved at every stage via createdAt/resolvedAt timestamps.
 *
 * @see SafetyGate (packages/core/src/self/safety.ts) for the enforcement layer
 * @see SelfModification (config/schema.ts) for the existing modification type
 */
export const ApprovalSchema = z.object({
  /** Unique proposal identifier (UUID v4). */
  proposalId: z.string().uuid(),

  /** Category of the proposed change. */
  type: ApprovalTypeSchema,

  /** Current status in the approval lifecycle. */
  status: ApprovalStatusSchema,

  /** Agent or user that proposed this change (e.g., `builder`, `human:troy`). */
  proposedBy: z.string().min(1),

  /** Agent or user that reviewed this proposal (absent while pending). */
  reviewedBy: z.string().optional(),

  /**
   * Structured payload describing the proposed change.
   * Shape is type-specific (e.g., config_change → { key, oldValue, newValue }).
   */
  payload: z.record(z.unknown()),

  /** ISO 8601 timestamp when the proposal was created. */
  createdAt: z.string().datetime(),

  /** ISO 8601 timestamp when the proposal was resolved (absent while pending). */
  resolvedAt: z.string().datetime().optional(),

  /** Human-readable reason for the approval or rejection decision. */
  reason: z.string().optional(),
});

export type Approval = z.infer<typeof ApprovalSchema>;
