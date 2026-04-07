import { z } from 'zod';

// ─── Event Envelope ───────────────────────────────────────────────────────────

/**
 * EventEnvelope — standard wrapper for all internal Redis events.
 *
 * Extends the basic AgentEvent (config/schema.ts) with codegen context fields
 * (runId, sessionId, threadKey) needed by the Builder/ACP execution pipeline.
 *
 * Use this type for events that carry codegen execution context. For simpler
 * inter-agent events without codegen context, AgentEvent is sufficient.
 */
export const EventEnvelopeSchema = z.object({
  /** ISO 8601 timestamp when the event was emitted. */
  timestamp: z.string().datetime(),

  /** Run ID of the codegen run that emitted this event (absent for non-codegen events). */
  runId: z.string().uuid().optional(),

  /** ACP or CLI session ID associated with this event (absent if no active session). */
  sessionId: z.string().optional(),

  /**
   * Thread key grouping this event with related iterative tasks.
   * @see computeThreadKey
   */
  threadKey: z.string().length(32).optional(),

  /** Agent that emitted this event (e.g., `builder`, `architect`). */
  agentId: z.string().min(1),

  /** Event type in `source:type` format (e.g., `builder:pr_ready`). */
  eventType: z.string().min(1),

  /** Arbitrary event payload. */
  payload: z.record(z.unknown()),

  /** Correlation ID for end-to-end tracing across agents and events. */
  correlationId: z.string().optional(),
});

export type EventEnvelope = z.infer<typeof EventEnvelopeSchema>;
