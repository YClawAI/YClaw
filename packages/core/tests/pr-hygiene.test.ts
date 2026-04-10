import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  hasNeedsHumanLabel,
  listPrHygieneCandidatesByBase,
  selectPrHygieneCandidates,
  shouldLabelNeedsHuman,
  type ListedPullRequestSummary,
} from '../src/bootstrap/pr-hygiene.js';
import { _resetForTesting as resetAuth } from '../src/actions/github/app-auth.js';
import {
  GitHubClient,
  GitHubRateLimitError,
  clearRateLimitBackoff,
  getRateLimitBackoffUntilMs,
} from '../src/actions/github/client.js';
import { PR_HYGIENE_RATE_LIMIT_TTL_SEC } from '../src/bootstrap/event-claims.js';

describe('pr hygiene candidate selection', () => {
  it('groups automated open PRs by base branch in oldest-first order', () => {
    const prs: ListedPullRequestSummary[] = [
      {
        number: 10,
        user: 'app/yclaw-agent-orchestrator',
        state: 'open',
        draft: false,
        created_at: '2026-03-30T10:00:00Z',
        head: { ref: 'feat/issue-10' },
        base: { ref: 'master' },
      },
      {
        number: 11,
        user: 'app/yclaw-agent-orchestrator',
        state: 'open',
        draft: false,
        created_at: '2026-03-30T11:00:00Z',
        head: { ref: 'feat/issue-11' },
        base: { ref: 'master' },
      },
      {
        number: 12,
        user: 'octocat',
        state: 'open',
        draft: false,
        created_at: '2026-03-30T09:00:00Z',
        head: { ref: 'feat/human' },
        base: { ref: 'master' },
      },
      {
        number: 13,
        user: 'app/yclaw-agent-orchestrator',
        state: 'open',
        draft: false,
        created_at: '2026-03-30T08:00:00Z',
        head: { ref: 'feat/landing' },
        base: { ref: 'main' },
      },
      {
        number: 14,
        user: 'app/yclaw-agent-orchestrator',
        state: 'open',
        draft: false,
        created_at: '2026-03-30T07:00:00Z',
        head: { ref: 'feat/conflicted' },
        base: { ref: 'master' },
        labels: [{ name: 'needs-human' }],
      },
    ];

    const grouped = listPrHygieneCandidatesByBase(prs);
    expect(grouped.get('master')).toEqual([
      expect.objectContaining({ prNumber: 10, baseBranch: 'master', headBranch: 'feat/issue-10' }),
      expect.objectContaining({ prNumber: 11, baseBranch: 'master', headBranch: 'feat/issue-11' }),
    ]);
    expect(grouped.get('main')).toEqual([
      expect.objectContaining({ prNumber: 13, baseBranch: 'main', headBranch: 'feat/landing' }),
    ]);
  });

  it('selects the oldest automated open PR per base branch', () => {
    const prs: ListedPullRequestSummary[] = [
      {
        number: 10,
        user: 'app/yclaw-agent-orchestrator',
        state: 'open',
        draft: false,
        created_at: '2026-03-30T10:00:00Z',
        head: { ref: 'feat/issue-10' },
        base: { ref: 'master' },
      },
      {
        number: 11,
        user: 'app/yclaw-agent-orchestrator',
        state: 'open',
        draft: false,
        created_at: '2026-03-30T11:00:00Z',
        head: { ref: 'feat/issue-11' },
        base: { ref: 'master' },
      },
      {
        number: 13,
        user: 'app/yclaw-agent-orchestrator',
        state: 'open',
        draft: false,
        created_at: '2026-03-30T08:00:00Z',
        head: { ref: 'feat/landing' },
        base: { ref: 'main' },
      },
      {
        number: 14,
        user: 'app/yclaw-agent-orchestrator',
        state: 'open',
        draft: false,
        created_at: '2026-03-30T07:00:00Z',
        head: { ref: 'feat/conflicted' },
        base: { ref: 'master' },
        labels: [{ name: 'needs-human' }],
      },
    ];

    expect(selectPrHygieneCandidates(prs)).toEqual([
      expect.objectContaining({ prNumber: 13, baseBranch: 'main', headBranch: 'feat/landing' }),
      expect.objectContaining({ prNumber: 10, baseBranch: 'master', headBranch: 'feat/issue-10' }),
    ]);
  });
});

describe('shouldLabelNeedsHuman', () => {
  it('flags only dirty/conflicting PRs in the first-pass hygiene worker', () => {
    expect(shouldLabelNeedsHuman('dirty')).toBe(true);
    expect(shouldLabelNeedsHuman('behind')).toBe(false);
    expect(shouldLabelNeedsHuman('clean')).toBe(false);
    expect(shouldLabelNeedsHuman(undefined)).toBe(false);
  });

  it('detects existing needs-human labels so those PRs can be skipped in future cycles', () => {
    expect(hasNeedsHumanLabel({ labels: [{ name: 'needs-human' }] })).toBe(true);
    expect(hasNeedsHumanLabel({ labels: [{ name: 'bug' }] })).toBe(false);
    expect(hasNeedsHumanLabel({})).toBe(false);
  });
});

describe('GitHubRateLimitError — backoff calculation used in runPrHygieneCycle', () => {
  it('carries retryAfterMs and name on the thrown error', () => {
    const futureMs = Date.now() + 120_000;
    const err = new GitHubRateLimitError(futureMs);
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(GitHubRateLimitError);
    expect(err.name).toBe('GitHubRateLimitError');
    expect(err.retryAfterMs).toBe(futureMs);
  });

  it('backoff is at least PR_HYGIENE_RATE_LIMIT_TTL_SEC when retryAfterMs is already in the past', () => {
    const pastMs = Date.now() - 5_000;
    const err = new GitHubRateLimitError(pastMs);
    const backoffSec = Math.max(
      Math.ceil((err.retryAfterMs - Date.now()) / 1000),
      PR_HYGIENE_RATE_LIMIT_TTL_SEC,
    );
    expect(backoffSec).toBe(PR_HYGIENE_RATE_LIMIT_TTL_SEC);
  });

  it('backoff honours the GitHub-requested duration when it exceeds the floor', () => {
    const longerThanFloor = PR_HYGIENE_RATE_LIMIT_TTL_SEC + 300; // 300 s more than floor
    const futureMs = Date.now() + longerThanFloor * 1000;
    const err = new GitHubRateLimitError(futureMs);
    const backoffSec = Math.max(
      Math.ceil((err.retryAfterMs - Date.now()) / 1000),
      PR_HYGIENE_RATE_LIMIT_TTL_SEC,
    );
    expect(backoffSec).toBeGreaterThanOrEqual(longerThanFloor);
    expect(backoffSec).toBeGreaterThan(PR_HYGIENE_RATE_LIMIT_TTL_SEC);
  });
});

describe('GitHubClient — module-level _rateLimitBackoffUntilMs pre-flight', () => {
  beforeEach(() => {
    // getGitHubToken() requires at least a PAT to be set
    process.env.GITHUB_TOKEN = 'ghp_test_rate_limit';
    resetAuth(); // Re-detect auth method after setting env var
  });

  afterEach(() => {
    delete process.env.GITHUB_TOKEN;
    resetAuth();
    clearRateLimitBackoff();
    vi.restoreAllMocks();
  });

  it('getRateLimitBackoffUntilMs returns 0 when no backoff is active', () => {
    expect(getRateLimitBackoffUntilMs()).toBe(0);
  });

  it('suppresses the network call and throws GitHubRateLimitError on a second request when backoff is active', async () => {
    // Trigger a 429 to arm the module-level backoff.
    const futureResetEpochSec = Math.floor((Date.now() + 120_000) / 1000);
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response(null, {
        status: 429,
        headers: { 'X-RateLimit-Reset': String(futureResetEpochSec) },
      }),
    );

    const client = new GitHubClient();

    // First call — network request made, 429 received, backoff armed.
    await expect(client.apiRequest('GET', '/rate_limit')).rejects.toBeInstanceOf(GitHubRateLimitError);
    expect(getRateLimitBackoffUntilMs()).toBeGreaterThan(Date.now());
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // Second call — pre-flight must throw without touching the network.
    await expect(client.apiRequest('GET', '/rate_limit')).rejects.toBeInstanceOf(GitHubRateLimitError);
    // Total fetch calls is still 1 — the pre-flight suppressed the second network call.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('clears the backoff and allows subsequent requests after clearRateLimitBackoff()', async () => {
    const futureResetEpochSec = Math.floor((Date.now() + 120_000) / 1000);
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response(null, {
        status: 429,
        headers: { 'X-RateLimit-Reset': String(futureResetEpochSec) },
      }),
    );

    const client = new GitHubClient();
    await expect(client.apiRequest('GET', '/rate_limit')).rejects.toBeInstanceOf(GitHubRateLimitError);
    expect(getRateLimitBackoffUntilMs()).toBeGreaterThan(0);

    clearRateLimitBackoff();
    expect(getRateLimitBackoffUntilMs()).toBe(0);

    // After clearing, fetch is invoked again (mock a 200 this time).
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(new Response('{}', { status: 200 }));
    const response = await client.apiRequest('GET', '/rate_limit');
    expect(response.status).toBe(200);
  });
});
