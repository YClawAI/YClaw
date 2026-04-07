import { createHash } from 'node:crypto';

/**
 * Compute a deterministic thread key from stable task fields.
 *
 * Thread keys group iterative tasks (e.g., implement → CI fix → re-review)
 * under a single ACP session so context is preserved across turns.
 *
 * Key is SHA-256(repo + prNumber + taskType) sliced to 32 hex chars.
 * Stable across worker restarts and deploys.
 */
export function computeThreadKey(task: {
  repoUrl?: string;
  prNumber?: string | number;
  taskType?: string;
}): string {
  const stable = JSON.stringify({
    repoUrl: task.repoUrl ?? '',
    prNumber: String(task.prNumber ?? ''),
    taskType: task.taskType ?? '',
  });
  return createHash('sha256').update(stable).digest('hex').slice(0, 32);
}

/**
 * Extract stable fields for threadKey generation from a trigger payload.
 * Returns null if the payload doesn't have enough stable identifiers.
 */
export function extractThreadKeyFields(
  taskName: string,
  payload: Record<string, unknown>,
): { repoUrl: string; prNumber: string; taskType: string } | null {
  const repo = (payload.repo as string | undefined)
    ?? (payload.repository as string | undefined)
    ?? '';
  const prNumber = String(
    (payload.pr_number as number | string | undefined)
    ?? (payload.prNumber as number | string | undefined)
    ?? '',
  );

  if (!repo && !prNumber) return null;

  return {
    repoUrl: repo,
    prNumber,
    taskType: taskName,
  };
}
