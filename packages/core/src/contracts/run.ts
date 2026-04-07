import { z } from 'zod';

// ─── Run Status ───────────────────────────────────────────────────────────────

export const RunStatusSchema = z.enum([
  'pending',
  'running',
  'completed',
  'failed',
  'cancelled',
]);

export type RunStatus = z.infer<typeof RunStatusSchema>;

// ─── Run Cost ─────────────────────────────────────────────────────────────────

export const RunCostSchema = z.object({
  inputUsd: z.number().nonnegative(),
  outputUsd: z.number().nonnegative(),
  totalUsd: z.number().nonnegative(),
});

export type RunCost = z.infer<typeof RunCostSchema>;

// ─── Run Record ───────────────────────────────────────────────────────────────

/**
 * RunRecord — tracks a single task execution attempt.
 *
 * A run represents one discrete attempt to complete a task (e.g., one codegen
 * session turn). Multiple runs can belong to the same session when a task
 * requires retries or iterative refinement.
 */
export const RunRecordSchema = z.object({
  /** Unique run identifier (UUID v4). */
  runId: z.string().uuid(),

  /** ACP or CLI session this run belongs to (absent for non-codegen runs). */
  sessionId: z.string().optional(),

  /** Agent that executed this run (e.g., `builder`, `architect`). */
  agentId: z.string().min(1),

  /** Task type that triggered this run (e.g., `implement_issue`, `fix_ci_failure`). */
  taskType: z.string().min(1),

  /** Final run status. */
  status: RunStatusSchema,

  /** Estimated LLM cost for this run. */
  cost: RunCostSchema.optional(),

  /** Files modified during this run (relative paths from repo root). */
  modifiedFiles: z.array(z.string()).default([]),

  /** ISO 8601 timestamp when the run started. */
  startedAt: z.string().datetime(),

  /** ISO 8601 timestamp when the run completed (absent while still running). */
  completedAt: z.string().datetime().optional(),

  /** Context compression metrics — present only if FF_CONTEXT_COMPRESSION was active. */
  compressionMetrics: z
    .object({
      tokensSaved: z.number().int().nonnegative(),
      turnsCompressed: z.number().int().nonnegative(),
    })
    .optional(),
});

export type RunRecord = z.infer<typeof RunRecordSchema>;
