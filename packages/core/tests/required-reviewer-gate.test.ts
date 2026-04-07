import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  evaluateRequiredReviewerGate,
  type RequiredReviewerParams,
} from '../src/reactions/required-reviewer-gate.js';

// --- Mock Octokit -----------------------------------------------------------

/**
 * Creates a mock Octokit that supports both `pulls.listReviews` and
 * `paginate()`. The gate uses `octokit.paginate(octokit.pulls.listReviews, ...)`
 * to handle PRs with 100+ reviews. The paginate mock returns the reviews
 * array directly (matching real Octokit.paginate behavior which unwraps
 * the `data` property and concatenates all pages).
 */
function createMockOctokit(reviews: Array<{ user: { login: string } | null; state: string }>) {
  const listReviews = vi.fn().mockResolvedValue({ data: reviews });
  return {
    pulls: { listReviews },
    paginate: vi.fn().mockResolvedValue(reviews),
  } as unknown as import('@octokit/rest').Octokit;
}

function createFailingOctokit(errorMessage: string) {
  return {
    pulls: {
      listReviews: vi.fn().mockRejectedValue(new Error(errorMessage)),
    },
    paginate: vi.fn().mockRejectedValue(new Error(errorMessage)),
  } as unknown as import('@octokit/rest').Octokit;
}

// --- Tests -------------------------------------------------------------------

describe('evaluateRequiredReviewerGate', () => {
  const owner = 'yclaw-ai';
  const repo = 'yclaw';
  const prNumber = 42;

  describe('when a required reviewer has approved', () => {
    it('passes when the required reviewer approved', async () => {
      const octokit = createMockOctokit([
        { user: { login: 'yclaw-architect' }, state: 'APPROVED' },
      ]);

      const result = await evaluateRequiredReviewerGate(
        octokit, owner, repo, prNumber,
        { reviewers: ['yclaw-architect'] },
      );

      expect(result.passed).toBe(true);
      expect(result.approvedBy).toEqual(['yclaw-architect']);
      expect(result.reason).toBeUndefined();
    });

    it('passes with case-insensitive username matching', async () => {
      const octokit = createMockOctokit([
        { user: { login: 'YClaw-Architect' }, state: 'APPROVED' },
      ]);

      const result = await evaluateRequiredReviewerGate(
        octokit, owner, repo, prNumber,
        { reviewers: ['yclaw-architect'] },
      );

      expect(result.passed).toBe(true);
      expect(result.approvedBy).toEqual(['yclaw-architect']);
    });

    it('passes when one of multiple required reviewers approved', async () => {
      const octokit = createMockOctokit([
        { user: { login: 'yclaw-architect' }, state: 'APPROVED' },
      ]);

      const result = await evaluateRequiredReviewerGate(
        octokit, owner, repo, prNumber,
        { reviewers: ['yclaw-architect', 'yclaw-reviewer'] },
      );

      expect(result.passed).toBe(true);
      expect(result.approvedBy).toEqual(['yclaw-architect']);
    });

    it('reports multiple approvers when both required reviewers approved', async () => {
      const octokit = createMockOctokit([
        { user: { login: 'yclaw-architect' }, state: 'APPROVED' },
        { user: { login: 'yclaw-reviewer' }, state: 'APPROVED' },
      ]);

      const result = await evaluateRequiredReviewerGate(
        octokit, owner, repo, prNumber,
        { reviewers: ['yclaw-architect', 'yclaw-reviewer'] },
      );

      expect(result.passed).toBe(true);
      expect(result.approvedBy).toHaveLength(2);
      expect(result.approvedBy).toContain('yclaw-architect');
      expect(result.approvedBy).toContain('yclaw-reviewer');
    });
  });

  describe('when no required reviewer has approved', () => {
    it('fails when there are no reviews at all', async () => {
      const octokit = createMockOctokit([]);

      const result = await evaluateRequiredReviewerGate(
        octokit, owner, repo, prNumber,
        { reviewers: ['yclaw-architect'] },
      );

      expect(result.passed).toBe(false);
      expect(result.approvedBy).toEqual([]);
      expect(result.reason).toContain('yclaw-architect');
    });

    it('fails when only non-required reviewers approved', async () => {
      const octokit = createMockOctokit([
        { user: { login: 'random-user' }, state: 'APPROVED' },
      ]);

      const result = await evaluateRequiredReviewerGate(
        octokit, owner, repo, prNumber,
        { reviewers: ['yclaw-architect'] },
      );

      expect(result.passed).toBe(false);
      expect(result.approvedBy).toEqual([]);
    });

    it('fails when required reviewer submitted CHANGES_REQUESTED', async () => {
      const octokit = createMockOctokit([
        { user: { login: 'yclaw-architect' }, state: 'CHANGES_REQUESTED' },
      ]);

      const result = await evaluateRequiredReviewerGate(
        octokit, owner, repo, prNumber,
        { reviewers: ['yclaw-architect'] },
      );

      expect(result.passed).toBe(false);
      expect(result.approvedBy).toEqual([]);
    });

    it('fails when required reviewer approved then requested changes', async () => {
      const octokit = createMockOctokit([
        { user: { login: 'yclaw-architect' }, state: 'APPROVED' },
        { user: { login: 'yclaw-architect' }, state: 'CHANGES_REQUESTED' },
      ]);

      const result = await evaluateRequiredReviewerGate(
        octokit, owner, repo, prNumber,
        { reviewers: ['yclaw-architect'] },
      );

      expect(result.passed).toBe(false);
      expect(result.approvedBy).toEqual([]);
      expect(result.reason).toContain('yclaw-architect');
    });

    it('passes when required reviewer requested changes then approved', async () => {
      const octokit = createMockOctokit([
        { user: { login: 'yclaw-architect' }, state: 'CHANGES_REQUESTED' },
        { user: { login: 'yclaw-architect' }, state: 'APPROVED' },
      ]);

      const result = await evaluateRequiredReviewerGate(
        octokit, owner, repo, prNumber,
        { reviewers: ['yclaw-architect'] },
      );

      expect(result.passed).toBe(true);
      expect(result.approvedBy).toEqual(['yclaw-architect']);
    });
  });

  describe('edge cases', () => {
    it('fails when reviewers list is empty', async () => {
      const octokit = createMockOctokit([]);

      const result = await evaluateRequiredReviewerGate(
        octokit, owner, repo, prNumber,
        { reviewers: [] },
      );

      expect(result.passed).toBe(false);
      expect(result.reason).toContain('misconfigured');
    });

    it('handles reviews with null user gracefully', async () => {
      const octokit = createMockOctokit([
        { user: { login: 'yclaw-architect' }, state: 'APPROVED' },
        { user: null, state: 'APPROVED' },
      ]);

      const result = await evaluateRequiredReviewerGate(
        octokit, owner, repo, prNumber,
        { reviewers: ['yclaw-architect'] },
      );

      expect(result.passed).toBe(true);
    });

    it('ignores COMMENTED and PENDING review states', async () => {
      const octokit = createMockOctokit([
        { user: { login: 'yclaw-architect' }, state: 'COMMENTED' },
        { user: { login: 'yclaw-architect' }, state: 'PENDING' },
      ]);

      const result = await evaluateRequiredReviewerGate(
        octokit, owner, repo, prNumber,
        { reviewers: ['yclaw-architect'] },
      );

      expect(result.passed).toBe(false);
      expect(result.approvedBy).toEqual([]);
    });
  });

  describe('fail-closed behavior', () => {
    it('fails when GitHub API returns an error', async () => {
      const octokit = createFailingOctokit('API rate limit exceeded');

      const result = await evaluateRequiredReviewerGate(
        octokit, owner, repo, prNumber,
        { reviewers: ['yclaw-architect'] },
      );

      expect(result.passed).toBe(false);
      expect(result.reason).toContain('Failed to fetch PR reviews');
      expect(result.reason).toContain('API rate limit exceeded');
    });

    it('fails when GitHub API returns a network error', async () => {
      const octokit = createFailingOctokit('getaddrinfo ENOTFOUND api.github.com');

      const result = await evaluateRequiredReviewerGate(
        octokit, owner, repo, prNumber,
        { reviewers: ['yclaw-architect'] },
      );

      expect(result.passed).toBe(false);
      expect(result.reason).toContain('Failed to fetch PR reviews');
    });
  });

  describe('pagination', () => {
    it('uses octokit.paginate to fetch all review pages', async () => {
      const octokit = createMockOctokit([
        { user: { login: 'yclaw-architect' }, state: 'APPROVED' },
      ]);

      await evaluateRequiredReviewerGate(
        octokit, owner, repo, prNumber,
        { reviewers: ['yclaw-architect'] },
      );

      // Verify paginate was called with the correct endpoint and params
      expect(octokit.paginate).toHaveBeenCalledWith(
        octokit.pulls.listReviews,
        {
          owner,
          repo,
          pull_number: prNumber,
          per_page: 100,
        },
      );
    });
  });
});
