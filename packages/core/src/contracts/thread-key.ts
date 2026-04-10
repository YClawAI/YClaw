import { createHash } from 'node:crypto';
import { z } from 'zod';

// ─── ThreadKey Input ──────────────────────────────────────────────────────────

/**
 * Stable fields used to derive a deterministic thread key.
 *
 * All three fields must be stable across worker restarts and re-deploys.
 * The thread key changes whenever any of these fields change.
 */
export const ThreadKeyInputSchema = z.object({
  /** Canonical repository URL (e.g., `https://github.com/YClawAI/my-app`). */
  repoUrl: z.string().min(1),

  /**
   * Pull request or issue number that anchors this thread.
   * Coerced to string for hashing. Absent for tasks without a PR context.
   */
  prNumber: z.union([z.string(), z.number()]).optional(),

  /** Task type (e.g., `implement_issue`, `fix_ci_failure`). */
  taskType: z.string().min(1),
});

export type ThreadKeyInput = z.infer<typeof ThreadKeyInputSchema>;

// ─── computeThreadKey ─────────────────────────────────────────────────────────

/**
 * Compute a deterministic thread key from stable task fields.
 *
 * Thread keys group iterative tasks (implement → CI fix → re-review) under a
 * single ACP session so LLM context is preserved across turns.
 *
 * Algorithm: SHA-256(JSON.stringify({ repoUrl, prNumber, taskType })) → first 32 hex chars.
 *
 * Compatible with the internal computeThreadKey in builder/dispatcher.ts.
 * This is the exported, canonical version.
 *
 * @example
 * computeThreadKey({
 *   repoUrl: 'https://github.com/YClawAI/my-app',
 *   prNumber: 42,
 *   taskType: 'implement_issue',
 * });
 * // → 'a1b2c3d4...' (32-char hex)
 */
export function computeThreadKey(input: ThreadKeyInput): string {
  const stable = JSON.stringify({
    repoUrl: input.repoUrl,
    prNumber: String(input.prNumber ?? ''),
    taskType: input.taskType,
  });
  return createHash('sha256').update(stable).digest('hex').slice(0, 32);
}
