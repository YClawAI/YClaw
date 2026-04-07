import { z } from 'zod';

// ─── Session Lifecycle State ──────────────────────────────────────────────────

export const SessionStateSchema = z.enum([
  'creating',
  'active',
  'detached',   // Worker released; session still alive on acpx
  'completed',
  'failed',
  'expired',
]);

export type SessionState = z.infer<typeof SessionStateSchema>;

// ─── Harness Type ─────────────────────────────────────────────────────────────

export const HarnessTypeSchema = z.enum([
  'claude-code',
  'codex',
  'opencode',
  'gemini-cli',
  'pi',
]);

export type HarnessType = z.infer<typeof HarnessTypeSchema>;

// ─── Session Token Usage ──────────────────────────────────────────────────────

export const SessionTokenUsageSchema = z.object({
  input: z.number().int().nonnegative(),
  output: z.number().int().nonnegative(),
  cacheReadTokens: z.number().int().nonnegative().optional(),
  cacheCreationTokens: z.number().int().nonnegative().optional(),
});

export type SessionTokenUsage = z.infer<typeof SessionTokenUsageSchema>;

// ─── Session Record ───────────────────────────────────────────────────────────

/**
 * SessionRecord — canonical representation of an ACP or CLI coding session.
 *
 * Tracks the lifecycle, model, harness, turn count, and token usage for a
 * single continuous coding session. Sessions are grouped into iterative task
 * threads via threadKey.
 *
 * @see ThreadKeyInput for threadKey generation
 */
export const SessionRecordSchema = z.object({
  /** ACP or CLI session identifier (e.g., `ses_<hex>` or `cli_<taskId>`). */
  sessionId: z.string().min(1),

  /**
   * Deterministic thread key (SHA-256 of repoUrl + prNumber + taskType).
   * Groups iterative tasks (implement → CI fix → re-review) into one session.
   * @see computeThreadKey
   */
  threadKey: z.string().length(32),

  /** Current lifecycle state of this session. */
  state: SessionStateSchema,

  /** LLM model name for this session (e.g., `claude-sonnet-4-6`). */
  model: z.string().min(1),

  /** Coding harness used for this session. */
  harness: HarnessTypeSchema,

  /** Number of LLM turns completed in this session. */
  turnCount: z.number().int().nonnegative().default(0),

  /** Cumulative token usage across all turns in this session. */
  tokenUsage: SessionTokenUsageSchema.optional(),

  /** ISO 8601 timestamp when the session was created. */
  createdAt: z.string().datetime(),

  /** ISO 8601 timestamp of the most recent activity in this session. */
  lastActiveAt: z.string().datetime(),

  /** Worker ID currently owning this session (absent when detached or completed). */
  ownerWorkerId: z.string().optional(),

  /**
   * System prompt snapshot ID — present when FF_PROMPT_CACHING is active.
   * First 32 hex chars of SHA-256(system_prompt_content).
   * Stable across requests: same content → same ID → Anthropic cache hit.
   */
  snapshotId: z.string().length(32).optional(),

  /**
   * Hex hash of the frozen system prompt text.
   * Identical to snapshotId — kept as a semantic alias for clarity.
   */
  textHash: z.string().length(32).optional(),
});

export type SessionRecord = z.infer<typeof SessionRecordSchema>;
