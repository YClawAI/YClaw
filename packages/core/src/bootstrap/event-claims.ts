type RedisClaimClient = {
  set(
    key: string,
    value: string,
    mode: 'EX',
    ttlSeconds: number,
    condition: 'NX',
  ): Promise<'OK' | null | unknown>;
};

export const EVENT_DISPATCH_DEDUP_TTL_SEC = 1800;
export const AO_DIRECTIVE_CLAIM_TTL_SEC = 900;
export const AO_FAILURE_SUMMARY_TTL_SEC = 600;
export const BRANCH_REFRESH_CLAIM_TTL_SEC = 900;
export const CI_REPAIR_CLAIM_TTL_SEC = 6 * 60 * 60;
// TTL must exceed the schedule interval (300 s) so an in-progress cycle
// cannot be "stolen" by the next timer tick before it finishes.
// The lock is also released explicitly in a finally block so normal
// completions free the slot immediately.
export const PR_HYGIENE_CYCLE_LOCK_TTL_SEC = 360;
export const PR_HYGIENE_PR_COOLDOWN_TTL_SEC = 900;
export const PR_HYGIENE_NEEDS_HUMAN_TTL_SEC = 6 * 60 * 60;
// Minimum Redis TTL for the rate-limit suppression key (15 minutes).
// The actual TTL is the larger of this value and the retry-after duration
// reported by GitHub, so the cycle never hammers the API sooner than GitHub
// asked us to wait.
export const PR_HYGIENE_RATE_LIMIT_TTL_SEC = 15 * 60;
// Cooldown after the circuit breaker opens: suppress per-repo circuit_open alerts for 15 minutes.
// All failures for the same repo share this dedup window — exactly one summary alert fires.
export const AO_CIRCUIT_OPEN_COOLDOWN_TTL_SEC = 900;
// Issue-scoped claim: prevents duplicate AO delegation from concurrent sweep + webhook + label events.
// TTL is 2 hours — longer than any AO session. Released explicitly on completion/failure.
export const ISSUE_CLAIM_TTL_SEC = 7200;

function normalizeIdentity(
  eventId?: string,
  correlationId?: string,
  fallback?: string,
): string {
  return eventId || correlationId || fallback || 'unknown';
}

export function buildEventDispatchDedupKey(params: {
  eventId?: string;
  correlationId?: string;
  agentName: string;
  task: string;
}): string {
  const identity = normalizeIdentity(params.eventId, params.correlationId);
  return `event:dispatch:${identity}:${params.agentName}:${params.task}`;
}

export function buildAoDirectiveClaimKey(params: {
  eventId?: string;
  correlationId?: string;
  repo?: string;
  issueNumber?: number;
}): string {
  const fallback = `${params.repo || 'unknown'}:${params.issueNumber ?? '?'}`;
  const identity = normalizeIdentity(params.eventId, params.correlationId, fallback);
  return `ao:directive:claim:${identity}`;
}

/**
 * Per-repo cooldown key for circuit_open alerts.
 * All circuit_open failures for the same repo share this key, so only the first
 * fires — subsequent ones are suppressed until the cooldown window expires.
 */
export function buildAoCircuitOpenCooldownKey(repo: string): string {
  return `ao:circuit-open:cooldown:${repo}`;
}

export function buildAoFailureSummaryKey(params: {
  repo?: string;
  eventKey?: string;
  reason?: string;
}): string {
  const repo = params.repo || 'unknown';
  const eventKey = params.eventKey || 'unknown';
  const reason = params.reason || 'unknown';
  return `ao:failure-summary:${repo}:${eventKey}:${reason}`;
}

export function buildAoDegradedHoldKey(repo?: string): string {
  return `ao:degraded:hold:${repo || 'unknown'}`;
}

export function buildBranchRefreshClaimKey(params: {
  eventId?: string;
  correlationId?: string;
  repo?: string;
  targetPullNumber: number;
}): string {
  const fallback = `${params.repo || 'unknown'}:${params.targetPullNumber}`;
  const identity = normalizeIdentity(params.eventId, params.correlationId, fallback);
  return `github:branch-refresh:${identity}:${params.targetPullNumber}`;
}

export function buildCiRepairClaimKey(params: {
  repo?: string;
  branch?: string;
  commitSha?: string;
}): string {
  const repo = params.repo || 'unknown';
  const branch = params.branch || 'unknown';
  const commitSha = params.commitSha || 'unknown';
  return `github:ci-repair:${repo}:${branch}:${commitSha}`;
}

export function buildPrHygieneCycleLockKey(): string {
  return 'github:pr-hygiene:cycle-lock';
}

export function buildPrHygieneCooldownKey(params: {
  repo?: string;
  pullNumber: number;
  action: 'update_branch' | 'enable_auto_merge' | 'needs_human';
}): string {
  const repo = params.repo || 'unknown';
  return `github:pr-hygiene:${repo}:${params.pullNumber}:${params.action}`;
}

export function buildPrHygieneNeedsHumanKey(params: {
  repo?: string;
  pullNumber: number;
}): string {
  const repo = params.repo || 'unknown';
  return `github:pr-hygiene:${repo}:${params.pullNumber}:needs-human-marker`;
}

/**
 * Redis key written when a GitHubRateLimitError is caught in the PR hygiene
 * cycle.  While this key exists the cycle pre-flight will skip execution,
 * backing off for the duration GitHub requested (minimum
 * PR_HYGIENE_RATE_LIMIT_TTL_SEC).
 */
export function buildPrHygieneRateLimitKey(): string {
  return 'github:pr-hygiene:rate-limit-suppression';
}

export function buildIssueClaimKey(repo: string, issueNumber: number): string {
  return `ao:issue-claim:${repo}#${issueNumber}`;
}

/**
 * Redis key for tracking the number of CI repair attempts for a given PR.
 * Key pattern: `repair:attempts:{owner}/{repo}/pr/{pr_number}`
 * Expires after 7 days to prevent Redis bloat.
 */
export function buildCiRepairAttemptsKey(params: {
  repoFull: string;
  prNumber: number;
}): string {
  return `repair:attempts:${params.repoFull}/pr/${params.prNumber}`;
}

/** TTL for repair attempt counters: 7 days. */
export const CI_REPAIR_ATTEMPTS_TTL_SEC = 7 * 24 * 60 * 60;

export async function claimDedupKey(
  redis: RedisClaimClient | null | undefined,
  key: string,
  ttlSeconds: number,
): Promise<boolean> {
  if (!redis) return true;
  const result = await redis.set(key, '1', 'EX', ttlSeconds, 'NX');
  return result === 'OK';
}
