/**
 * Required Reviewer Gate — verifies that at least one APPROVED review
 * comes from a specified set of GitHub usernames.
 *
 * This gate prevents auto-merge of PRs that haven't been reviewed by
 * a qualified reviewer (e.g., the Architect agent). It was introduced
 * after the github-compare.ts incident where code with a missing
 * dependency reached master without proper review.
 *
 * Usage in rules.ts:
 *   { type: 'required_reviewer', params: { reviewers: ['yclaw-architect'] } }
 *
 * The gate fetches all reviews on the PR via the GitHub API and checks
 * that at least one review with state === 'APPROVED' was submitted by
 * a user whose login is in the `reviewers` array.
 */

import type { Octokit } from '@octokit/rest';
import { createLogger } from '../logging/logger.js';

const logger = createLogger('required-reviewer-gate');

export interface RequiredReviewerParams {
  /** GitHub usernames that qualify as required reviewers. */
  reviewers: string[];
}

export interface RequiredReviewerResult {
  passed: boolean;
  /** Which required reviewer(s) approved, if any. */
  approvedBy: string[];
  /** All reviewers checked against. */
  requiredReviewers: string[];
  reason?: string;
}

/**
 * Evaluate whether a PR has at least one APPROVED review from a
 * required reviewer.
 *
 * Fetches all reviews on the PR using pagination and checks the latest
 * review state per user. A reviewer who submitted REQUEST_CHANGES after
 * APPROVED does NOT count as approved — only the latest review state matters.
 */
export async function evaluateRequiredReviewerGate(
  octokit: Octokit,
  owner: string,
  repo: string,
  prNumber: number,
  params: RequiredReviewerParams,
): Promise<RequiredReviewerResult> {
  const { reviewers } = params;

  if (!reviewers || reviewers.length === 0) {
    logger.warn('required_reviewer gate called with empty reviewers list');
    return {
      passed: false,
      approvedBy: [],
      requiredReviewers: [],
      reason: 'required_reviewer gate misconfigured: reviewers list is empty',
    };
  }

  // Normalize reviewer names to lowercase for case-insensitive comparison
  const requiredSet = new Set(reviewers.map((r) => r.toLowerCase()));

  try {
    // Fetch all reviews on the PR using pagination to handle PRs with 100+ reviews.
    // octokit.paginate automatically follows Link headers and concatenates all pages.
    const reviews = await octokit.paginate(octokit.pulls.listReviews, {
      owner,
      repo,
      pull_number: prNumber,
      per_page: 100,
    });

    // Build a map of latest review state per user.
    // GitHub returns reviews in chronological order, so the last entry
    // for each user is their current review state.
    const latestReviewByUser = new Map<string, string>();
    for (const review of reviews) {
      const login = review.user?.login?.toLowerCase();
      if (!login) continue;
      // Only track meaningful review states
      if (review.state === 'APPROVED' || review.state === 'CHANGES_REQUESTED') {
        latestReviewByUser.set(login, review.state);
      }
    }

    // Check which required reviewers have approved
    const approvedBy: string[] = [];
    for (const reviewer of requiredSet) {
      const state = latestReviewByUser.get(reviewer);
      if (state === 'APPROVED') {
        approvedBy.push(reviewer);
      }
    }

    const passed = approvedBy.length > 0;

    const result: RequiredReviewerResult = {
      passed,
      approvedBy,
      requiredReviewers: reviewers,
      reason: passed
        ? undefined
        : `No approved review from required reviewer(s): ${reviewers.join(', ')}. ` +
          `Found reviews from: ${[...latestReviewByUser.entries()].map(([u, s]) => `${u}(${s})`).join(', ') || 'none'}`,
    };

    logger.info('Required reviewer gate evaluated', {
      passed,
      prNumber,
      requiredReviewers: reviewers,
      approvedBy,
      totalReviews: reviews.length,
    });

    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('Failed to evaluate required reviewer gate', {
      error: message,
      owner,
      repo,
      prNumber,
    });

    // Fail closed — if we can't check reviews, don't allow merge
    return {
      passed: false,
      approvedBy: [],
      requiredReviewers: reviewers,
      reason: `Failed to fetch PR reviews: ${message}`,
    };
  }
}
