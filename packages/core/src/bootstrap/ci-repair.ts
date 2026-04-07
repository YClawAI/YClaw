import { createLogger } from '../logging/logger.js';
import {
  getCiRepairAttempts,
  incrementCiRepairAttempts,
  MAX_CI_REPAIR_ATTEMPTS,
} from '../triggers/ci-classifier.js';

const logger = createLogger('bootstrap:ci-repair');

// Minimal redis interface required by the cap gate
type CiRepairRedis = {
  incr(key: string): Promise<number>;
  expire(key: string, ttlSeconds: number): Promise<number>;
  get(key: string): Promise<string | null>;
};

// Minimal executor interface required for label application
type CiCapLabelExec = {
  execute(action: string, params: Record<string, unknown>): Promise<{ success: boolean; error?: string }>;
};

export interface CiRepairCapGateResult {
  /** Whether repair should proceed (i.e. attempt count was below the cap). */
  shouldProceed: boolean;
  /** The attempt count that was read before deciding. */
  repairAttempts: number;
}

/**
 * Checks the CI repair attempt cap for a given PR and either:
 *  - increments the counter and returns `{ shouldProceed: true }` when below the cap, or
 *  - applies a `needs-human` label (if issueNumber is present) and returns
 *    `{ shouldProceed: false }` when the cap has been reached.
 *
 * Extracting this logic from the agents.ts event handler makes it independently
 * testable without wiring up the full bootstrap context.
 */
export async function handleCiRepairCapGate(params: {
  redis: CiRepairRedis | null | undefined;
  githubExec: CiCapLabelExec | null | undefined;
  repoFull: string;
  owner: string;
  repo: string;
  prNumber: number;
  issueNumber: number | undefined;
}): Promise<CiRepairCapGateResult> {
  const { redis, githubExec, repoFull, owner, repo, prNumber, issueNumber } = params;

  const repairAttempts = await getCiRepairAttempts(redis, repoFull, prNumber);

  if (repairAttempts >= MAX_CI_REPAIR_ATTEMPTS) {
    logger.warn(
      `[CIRepair] CI repair attempt limit reached for PR #${prNumber}, escalating to needs-human`,
      { repo: repoFull, prNumber, repairAttempts, limit: MAX_CI_REPAIR_ATTEMPTS },
    );

    if (issueNumber && githubExec) {
      const labelResult = await githubExec.execute('add_labels', {
        owner,
        repo,
        issue_number: issueNumber,
        labels: ['needs-human'],
      });
      if (labelResult.success) {
        logger.info('[CIRepair] Applied needs-human label to original issue after cap reached', {
          repo: repoFull,
          issueNumber,
          prNumber,
        });
      } else {
        logger.warn('[CIRepair] Failed to apply needs-human label to original issue', {
          repo: repoFull,
          issueNumber,
          prNumber,
          error: labelResult.error,
        });
      }
    }

    return { shouldProceed: false, repairAttempts };
  }

  // Increment before spawning so parallel events don't both slip under the cap.
  await incrementCiRepairAttempts(redis, repoFull, prNumber);

  return { shouldProceed: true, repairAttempts };
}

export interface OpenPullRequestSummary {
  number?: number;
  user?: string;
  state?: string;
  draft?: boolean;
  html_url?: string;
  head?: {
    ref?: string;
    sha?: string;
  };
}

export interface CiRepairTarget {
  prNumber: number;
  prUrl?: string;
  branch: string;
  author: string;
  issueNumber?: number;
}

export function isAutomatedPrAuthor(login: string | undefined): boolean {
  if (!login) return false;
  return login.endsWith('[bot]') || login.startsWith('app/');
}

export function extractIssueNumberFromBranch(branch: string | undefined): number | undefined {
  if (!branch) return undefined;

  // Match explicit `issue-{N}` patterns: feat/issue-713, hotfix/issue-12-retry, issue-713
  const issueMatch = branch.match(/(?:^|[/-])issue-(\d+)(?:$|[/-])/);
  if (issueMatch) {
    const n = Number.parseInt(issueMatch[1] ?? '', 10);
    return Number.isFinite(n) && n > 0 ? n : undefined;
  }

  // Match bare numeric segment after a slash: feat/713, agent/fix/713-description, ao/713
  const numericMatch = branch.match(/\/(\d+)(?:$|[-/])/);
  if (numericMatch) {
    const n = Number.parseInt(numericMatch[1] ?? '', 10);
    return Number.isFinite(n) && n > 0 ? n : undefined;
  }

  return undefined;
}

export function selectCiRepairTarget(
  prs: OpenPullRequestSummary[],
  branch: string,
): CiRepairTarget | null {
  for (const pr of prs) {
    const headRef = pr.head?.ref;
    if (headRef !== branch) continue;
    if (pr.state !== 'open') continue;
    if (pr.draft === true) continue;
    if (!isAutomatedPrAuthor(pr.user)) continue;
    if (typeof pr.number !== 'number') continue;

    const issueNumber = extractIssueNumberFromBranch(headRef);

    return {
      prNumber: pr.number,
      branch: headRef,
      author: pr.user || 'unknown',
      ...(pr.html_url ? { prUrl: pr.html_url } : {}),
      ...(issueNumber ? { issueNumber } : {}),
    };
  }

  return null;
}

export function buildCiRepairDirective(params: {
  repoFull: string;
  prNumber: number;
  branch: string;
  commitSha: string;
  workflow?: string;
  runUrl?: string;
  issueNumber?: number;
  failureSummary?: string;
  failedJob?: string;
  failureLogExcerpt?: string;
}): string {
  const lines = [
    'Fix the failing CI for an existing AO-managed pull request.',
    `Repository: ${params.repoFull}`,
    `Pull request: #${params.prNumber}`,
    params.issueNumber ? `Original issue: #${params.issueNumber}` : undefined,
    `Existing branch: ${params.branch}`,
    `Failing commit: ${params.commitSha}`,
    params.workflow ? `Failing workflow: ${params.workflow}` : undefined,
    params.runUrl ? `Workflow run: ${params.runUrl}` : undefined,
    params.failedJob ? `Failed job: ${params.failedJob}` : undefined,
    params.failureSummary ? `Failure summary: ${params.failureSummary}` : undefined,
    '',
    'Requirements:',
    `- Work on the existing branch \`${params.branch}\`.`,
    `- Do not create a new branch or pull request if PR #${params.prNumber} is still open.`,
    '- Inspect the latest failed GitHub Actions run for this PR before deciding the work is already fixed.',
    '- Reconcile your changes against the actual failing check output, not just the existing PR diff.',
    '- Diagnose the failing required checks and make the smallest safe fix.',
    '- Push commits to the same branch so GitHub reruns checks.',
    `- Preserve or re-enable GitHub auto-merge on PR #${params.prNumber} if needed.`,
    '- If the failure is unrelated infrastructure noise and no code change is justified, report the blocker clearly instead of churning code.',
    '',
    params.failureLogExcerpt ? 'Failure log excerpt:' : undefined,
    params.failureLogExcerpt || undefined,
  ];

  return lines.filter((line): line is string => Boolean(line)).join('\n');
}
