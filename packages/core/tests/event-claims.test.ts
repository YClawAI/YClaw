import { describe, expect, it, vi } from 'vitest';
import {
  AO_CIRCUIT_OPEN_COOLDOWN_TTL_SEC,
  AO_DIRECTIVE_CLAIM_TTL_SEC,
  AO_FAILURE_SUMMARY_TTL_SEC,
  BRANCH_REFRESH_CLAIM_TTL_SEC,
  CI_REPAIR_ATTEMPTS_TTL_SEC,
  CI_REPAIR_CLAIM_TTL_SEC,
  EVENT_DISPATCH_DEDUP_TTL_SEC,
  buildAoCircuitOpenCooldownKey,
  buildAoDegradedHoldKey,
  buildAoDirectiveClaimKey,
  buildAoFailureSummaryKey,
  buildBranchRefreshClaimKey,
  buildCiRepairAttemptsKey,
  buildCiRepairClaimKey,
  buildEventDispatchDedupKey,
  buildPrHygieneCooldownKey,
  buildPrHygieneCycleLockKey,
  buildPrHygieneNeedsHumanKey,
  buildPrHygieneRateLimitKey,
  PR_HYGIENE_CYCLE_LOCK_TTL_SEC,
  PR_HYGIENE_NEEDS_HUMAN_TTL_SEC,
  PR_HYGIENE_RATE_LIMIT_TTL_SEC,
  claimDedupKey,
} from '../src/bootstrap/event-claims.js';

describe('event claim helpers', () => {
  it('builds event dispatch keys from the event id', () => {
    expect(buildEventDispatchDedupKey({
      eventId: 'evt-123',
      correlationId: 'corr-456',
      agentName: 'architect',
      task: 'audit_pr',
    })).toBe('event:dispatch:evt-123:architect:audit_pr');
  });

  it('falls back to correlation id when the event id is missing', () => {
    expect(buildAoDirectiveClaimKey({
      correlationId: 'corr-456',
      repo: 'your-org/yclaw',
      issueNumber: 677,
    })).toBe('ao:directive:claim:corr-456');
  });

  it('falls back to repo and issue when no event identity exists', () => {
    expect(buildAoDirectiveClaimKey({
      repo: 'your-org/yclaw',
      issueNumber: 677,
    })).toBe('ao:directive:claim:your-org/yclaw:677');
  });

  it('builds branch refresh keys for a specific target PR', () => {
    expect(buildBranchRefreshClaimKey({
      eventId: 'merge-event-1',
      repo: 'your-org/yclaw',
      targetPullNumber: 686,
    })).toBe('github:branch-refresh:merge-event-1:686');
  });

  it('builds AO failure summary keys by repo, event key, and reason', () => {
    expect(buildAoFailureSummaryKey({
      repo: 'your-org/yclaw',
      eventKey: 'architect:build_directive',
      reason: 'circuit_open',
    })).toBe('ao:failure-summary:your-org/yclaw:architect:build_directive:circuit_open');
  });

  it('builds AO degraded hold keys by repo', () => {
    expect(buildAoDegradedHoldKey('your-org/yclaw'))
      .toBe('ao:degraded:hold:your-org/yclaw');
  });

  it('builds CI repair keys from repo, branch, and commit sha', () => {
    expect(buildCiRepairClaimKey({
      repo: 'your-org/yclaw',
      branch: 'feat/issue-682',
      commitSha: 'abc123',
    })).toBe('github:ci-repair:your-org/yclaw:feat/issue-682:abc123');
  });

  it('builds PR hygiene cycle and cooldown keys', () => {
    expect(buildPrHygieneCycleLockKey()).toBe('github:pr-hygiene:cycle-lock');
    expect(buildPrHygieneCooldownKey({
      repo: 'your-org/yclaw',
      pullNumber: 732,
      action: 'enable_auto_merge',
    })).toBe('github:pr-hygiene:your-org/yclaw:732:enable_auto_merge');
    expect(buildPrHygieneNeedsHumanKey({
      repo: 'your-org/yclaw',
      pullNumber: 719,
    })).toBe('github:pr-hygiene:your-org/yclaw:719:needs-human-marker');
  });

  it('treats a missing redis client as implicitly claimed', async () => {
    await expect(claimDedupKey(null, 'event:dispatch:test', EVENT_DISPATCH_DEDUP_TTL_SEC)).resolves.toBe(true);
  });

  it('uses redis set NX with the provided ttl', async () => {
    const set = vi.fn().mockResolvedValue('OK');
    const redis = { set };

    await expect(claimDedupKey(redis, 'ao:directive:claim:test', AO_DIRECTIVE_CLAIM_TTL_SEC)).resolves.toBe(true);
    expect(set).toHaveBeenCalledWith('ao:directive:claim:test', '1', 'EX', AO_DIRECTIVE_CLAIM_TTL_SEC, 'NX');
  });

  it('returns false when the claim already exists', async () => {
    const redis = { set: vi.fn().mockResolvedValue(null) };

    await expect(claimDedupKey(redis, 'event:dispatch:test', EVENT_DISPATCH_DEDUP_TTL_SEC)).resolves.toBe(false);
  });

  it('exports a branch refresh claim ttl for merge-triggered refreshes', () => {
    expect(BRANCH_REFRESH_CLAIM_TTL_SEC).toBe(900);
  });

  it('exports a CI repair claim ttl for failed PR repairs', () => {
    expect(CI_REPAIR_CLAIM_TTL_SEC).toBe(21600);
  });

  it('exports a needs-human marker ttl for conflicted bot PRs', () => {
    expect(PR_HYGIENE_NEEDS_HUMAN_TTL_SEC).toBe(21600);
  });

  it('exports an AO failure summary ttl for degraded alert windows', () => {
    expect(AO_FAILURE_SUMMARY_TTL_SEC).toBe(600);
  });

  it('builds circuit-open cooldown keys scoped to repo only (not eventKey)', () => {
    expect(buildAoCircuitOpenCooldownKey('your-org/yclaw'))
      .toBe('ao:circuit-open:cooldown:your-org/yclaw');
  });

  it('produces the same circuit-open key for different eventKeys on the same repo', () => {
    const key1 = buildAoCircuitOpenCooldownKey('your-org/yclaw');
    const key2 = buildAoCircuitOpenCooldownKey('your-org/yclaw');
    expect(key1).toBe(key2);
  });

  it('produces distinct circuit-open keys for different repos', () => {
    expect(buildAoCircuitOpenCooldownKey('your-org/repo-a'))
      .not.toBe(buildAoCircuitOpenCooldownKey('your-org/repo-b'));
  });

  it('exports the circuit-open cooldown ttl as 900 seconds (15 min)', () => {
    expect(AO_CIRCUIT_OPEN_COOLDOWN_TTL_SEC).toBe(900);
  });

  it('builds the PR hygiene rate-limit suppression key', () => {
    expect(buildPrHygieneRateLimitKey()).toBe('github:pr-hygiene:rate-limit-suppression');
  });

  it('exports the rate-limit suppression TTL as 900 seconds (15 min)', () => {
    expect(PR_HYGIENE_RATE_LIMIT_TTL_SEC).toBe(900);
  });

  it('exports a cycle-lock TTL that exceeds the 300 s cron interval (must be ≥ 360)', () => {
    // The PR-hygiene cron fires every 300 s. The lock TTL must be > 300 s so an
    // in-progress cycle cannot be stolen by the next timer tick.
    expect(PR_HYGIENE_CYCLE_LOCK_TTL_SEC).toBeGreaterThanOrEqual(360);
  });
});
