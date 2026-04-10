/**
 * CI Failure Classifier
 *
 * Pre-filters CI failures before they reach Builder.
 * Distinguishes transient infrastructure failures (Docker Hub 500, npm timeout)
 * from actual code failures (test assertions, type errors, lint failures).
 *
 * Flow: github:ci_fail webhook → classifier → auto-retry OR Builder
 */

import { createLogger } from '../logging/logger.js';
import { buildCiRepairAttemptsKey, CI_REPAIR_ATTEMPTS_TTL_SEC } from '../bootstrap/event-claims.js';
import { getGitHubToken } from '../actions/github/app-auth.js';

const logger = createLogger('ci-classifier');
const MAX_FAILURE_LOG_EXCERPT_CHARS = 1500;

export interface CIFailureClassification {
  category: 'infra_transient' | 'code_failure' | 'already_resolved' | 'unknown';
  shouldInvokeBuilder: boolean;
  shouldAutoRetry: boolean;
  matchedPattern: string | null;
  summary: string;
  failedJobName?: string;
  logExcerpt?: string;
}

// ─── Transient Infrastructure Patterns ────────────────────────────────────
// These errors are NOT fixable by code changes. Auto-retry or escalate.
const TRANSIENT_INFRA_PATTERNS: Array<{ pattern: RegExp; description: string }> = [
  // Docker Hub / Container Registry
  { pattern: /received unexpected HTTP status: 5\d{2}/i, description: 'Docker registry HTTP 5xx' },
  { pattern: /toomanyrequests.*pull rate limit/i, description: 'Docker Hub rate limit' },
  { pattern: /error.*pulling image.*(?:5\d{2}|timeout)/i, description: 'Docker image pull failure' },
  { pattern: /dial tcp.*docker\.io.*(?:timeout|refused)/i, description: 'Docker Hub connection failure' },
  { pattern: /unexpected EOF.*(?:docker|registry)/i, description: 'Docker pull interrupted' },
  { pattern: /buildkit.*(?:5\d{2}|error|failed)/i, description: 'BuildKit infrastructure error' },

  // npm / Package Registries
  { pattern: /npm ERR! (?:network|fetch)/i, description: 'npm network error' },
  { pattern: /ETIMEDOUT.*registry\.npmjs/i, description: 'npm registry timeout' },
  { pattern: /ERR!.*(?:503|504).*(?:npm|registry)/i, description: 'npm registry outage' },
  { pattern: /ECONNRESET.*(?:npm|registry)/i, description: 'npm registry connection reset' },
  { pattern: /ERR! code FETCH_ERROR/i, description: 'npm fetch error' },

  // GitHub Actions Runner
  { pattern: /No space left on device/i, description: 'Runner disk full' },
  { pattern: /runner.*(?:shutdown|lost communication|terminated)/i, description: 'Runner shutdown/lost' },
  { pattern: /The operation was canceled/i, description: 'Job cancelled externally' },
  { pattern: /HttpError: API rate limit exceeded/i, description: 'GitHub API rate limit' },

  // Generic Infrastructure
  { pattern: /(?:502|503|504) (?:Bad Gateway|Service Unavailable|Gateway Timeout)/i, description: 'HTTP infrastructure error' },
  { pattern: /ETIMEDOUT(?!.*localhost)(?!.*127\.0\.0\.1)/i, description: 'External network timeout' },
  { pattern: /ECONNREFUSED(?!.*localhost)(?!.*127\.0\.0\.1)/i, description: 'External connection refused' },
  { pattern: /ENOTFOUND(?!.*localhost)/i, description: 'DNS resolution failure' },
  { pattern: /SSL_ERROR_SYSCALL/i, description: 'SSL/TLS infrastructure error' },
];

/**
 * Check if a newer successful run exists for the same commit SHA and workflow.
 * A successful run from a different workflow (for example Agent Safety Guard)
 * must not suppress repair for the failing CI workflow.
 */
export async function hasNewerSuccessfulRun(
  owner: string,
  repo: string,
  headSha: string,
  failedRunId: number,
  workflowName: string,
): Promise<boolean> {
  try {
    const ghToken = await getGitHubToken();
    const url = `https://api.github.com/repos/${owner}/${repo}/actions/runs?head_sha=${headSha}&per_page=10`;
    const response = await fetch(url, {
      headers: {
        'Accept': 'application/vnd.github+json',
        'Authorization': `Bearer ${ghToken}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });

    if (!response.ok) {
      logger.warn('Failed to check for newer runs', { status: response.status });
      return false;
    }

    const data = (await response.json()) as {
      workflow_runs: Array<{
        id: number;
        name: string;
        conclusion: string | null;
        status: string;
      }>;
    };

    // Check if any OTHER run for the same SHA and workflow succeeded or is in progress.
    return data.workflow_runs.some(run =>
      run.id !== failedRunId &&
      run.name === workflowName &&
      (run.conclusion === 'success' || run.status === 'in_progress'),
    );
  } catch (err) {
    logger.warn('Error checking for newer runs', {
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

/**
 * Fetch the last N lines of failed job logs and classify the failure.
 */
export async function classifyCIFailure(
  owner: string,
  repo: string,
  runId: number,
): Promise<CIFailureClassification> {
  try {
    // Fetch failed job logs (last 200 lines of each failed job)
    const ghToken = await getGitHubToken();
    const jobsUrl = `https://api.github.com/repos/${owner}/${repo}/actions/runs/${runId}/jobs?filter=latest`;
    const jobsResponse = await fetch(jobsUrl, {
      headers: {
        'Accept': 'application/vnd.github+json',
        'Authorization': `Bearer ${ghToken}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });

    if (!jobsResponse.ok) {
      logger.warn('Failed to fetch jobs for classification', { runId, status: jobsResponse.status });
      return {
        category: 'unknown',
        shouldInvokeBuilder: true,
        shouldAutoRetry: false,
        matchedPattern: null,
        summary: 'Could not fetch job data',
      };
    }

    const jobsData = (await jobsResponse.json()) as {
      jobs: Array<{ id: number; name: string; conclusion: string | null }>;
    };

    const failedJobs = jobsData.jobs.filter(j => j.conclusion === 'failure');
    if (failedJobs.length === 0) {
      return {
        category: 'unknown',
        shouldInvokeBuilder: false,
        shouldAutoRetry: false,
        matchedPattern: null,
        summary: 'No failed jobs found',
      };
    }

    const failedJob = failedJobs[0];

    // Fetch logs for the first failed job
    const logUrl = `https://api.github.com/repos/${owner}/${repo}/actions/jobs/${failedJob.id}/logs`;
    const logResponse = await fetch(logUrl, {
      headers: {
        'Accept': 'application/vnd.github+json',
        'Authorization': `Bearer ${ghToken}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
      redirect: 'follow',
    });

    let logText = '';
    if (logResponse.ok) {
      const fullLog = await logResponse.text();
      // Only check last 5000 chars to keep it fast
      logText = fullLog.slice(-5000);
    } else {
      logger.warn('Failed to fetch job logs', { jobId: failedJob.id, status: logResponse.status });
    }

    const trimmedLog = logText.trim();
    const logExcerpt = trimmedLog
      ? trimmedLog.slice(-MAX_FAILURE_LOG_EXCERPT_CHARS)
      : undefined;

    // Match against transient patterns
    for (const { pattern, description } of TRANSIENT_INFRA_PATTERNS) {
      if (pattern.test(logText)) {
        logger.info('Transient infrastructure failure detected', {
          runId,
          pattern: description,
          job: failedJobs[0].name,
        });
        return {
          category: 'infra_transient',
          shouldInvokeBuilder: false,
          shouldAutoRetry: true,
          matchedPattern: description,
          summary: `Transient infra failure: ${description}`,
          failedJobName: failedJob.name,
          logExcerpt,
        };
      }
    }

    // No transient pattern matched — likely a real code failure
    return {
      category: 'code_failure',
      shouldInvokeBuilder: true,
      shouldAutoRetry: false,
      matchedPattern: null,
      summary: `Code failure in job: ${failedJob.name}`,
      failedJobName: failedJob.name,
      logExcerpt,
    };
  } catch (err) {
    logger.warn('CI classifier error — defaulting to Builder', {
      runId,
      error: err instanceof Error ? err.message : String(err),
    });
    return {
      category: 'unknown',
      shouldInvokeBuilder: true,
      shouldAutoRetry: false,
      matchedPattern: null,
      summary: 'Classifier error',
    };
  }
}

// ─── Redis repair attempt counter type ────────────────────────────────────
type RedisIncrClient = {
  incr(key: string): Promise<number>;
  expire(key: string, ttlSeconds: number): Promise<number>;
  get(key: string): Promise<string | null>;
};

/** Maximum number of CI repair attempts allowed per PR before escalating. */
export const MAX_CI_REPAIR_ATTEMPTS = 2;

/**
 * Increment the repair attempt counter for a given PR.
 * The counter expires automatically after 7 days.
 * Returns the new attempt count.
 */
export async function incrementCiRepairAttempts(
  redis: RedisIncrClient | null | undefined,
  repoFull: string,
  prNumber: number,
): Promise<number> {
  if (!redis) return 1;
  try {
    const key = buildCiRepairAttemptsKey({ repoFull, prNumber });
    const count = await redis.incr(key);
    if (count === 1) {
      // Set TTL on first increment to prevent Redis bloat
      await redis.expire(key, CI_REPAIR_ATTEMPTS_TTL_SEC);
    }
    logger.info('CI repair attempt counter incremented', { repoFull, prNumber, count });
    return count;
  } catch (err) {
    logger.warn('Failed to increment CI repair attempt counter', {
      repoFull,
      prNumber,
      error: err instanceof Error ? err.message : String(err),
    });
    return 1;
  }
}

/**
 * Get the current repair attempt count for a given PR.
 * Returns 0 if the counter does not exist.
 */
export async function getCiRepairAttempts(
  redis: RedisIncrClient | null | undefined,
  repoFull: string,
  prNumber: number,
): Promise<number> {
  if (!redis) return 0;
  try {
    const key = buildCiRepairAttemptsKey({ repoFull, prNumber });
    const val = await redis.get(key);
    return val ? parseInt(val, 10) : 0;
  } catch (err) {
    logger.warn('Failed to get CI repair attempt counter', {
      repoFull,
      prNumber,
      error: err instanceof Error ? err.message : String(err),
    });
    return 0;
  }
}

/**
 * Auto-retry a failed workflow run via GitHub API.
 * Returns true if the retry was triggered successfully.
 */
export async function autoRetryWorkflowRun(
  owner: string,
  repo: string,
  runId: number,
): Promise<boolean> {
  try {
    const ghToken = await getGitHubToken();
    const url = `https://api.github.com/repos/${owner}/${repo}/actions/runs/${runId}/rerun-failed-jobs`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Accept': 'application/vnd.github+json',
        'Authorization': `Bearer ${ghToken}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });

    if (response.ok || response.status === 201) {
      logger.info('Auto-retried failed workflow run', { owner, repo, runId });
      return true;
    }

    logger.warn('Failed to auto-retry workflow run', { runId, status: response.status });
    return false;
  } catch (err) {
    logger.warn('Error auto-retrying workflow run', {
      runId,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}
