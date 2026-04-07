/**
 * Condition & Safety Gate evaluator.
 *
 * Queries GitHub API to evaluate conditions (pr_approved, ci_green, etc.)
 * and safety gates (all_checks_passed, no_merge_conflicts, etc.).
 *
 * Uses Redis cache (60s TTL) to avoid GitHub API rate limits when multiple
 * rules evaluate the same PR in quick succession.
 */

import type { Redis } from 'ioredis';
import type { ReactionCondition, SafetyGate, ReactionContext } from './types.js';
import { createLogger } from '../logging/logger.js';

const logger = createLogger('reaction-evaluator');

const GITHUB_API = 'https://api.github.com';
const CACHE_TTL = 60; // seconds

interface PRState {
  merged: boolean;
  mergeable: boolean | null;
  mergeable_state: string | null; // 'clean', 'behind', 'dirty', 'blocked', etc.
  labels: string[];
  draft: boolean;
  state: string; // 'open' | 'closed'
  body: string | null;
}

interface ReviewSummary {
  approved: number;
  changesRequested: number;
  reviewers: string[];
}

interface ChecksSummary {
  allPassed: boolean;
  totalChecks: number;
  failedChecks: string[];
}

export class ReactionEvaluator {
  constructor(
    private redis: Redis,
    private githubToken: string,
  ) {}

  // ─── Public: Evaluate Conditions ────────────────────────────────────────

  async evaluateConditions(
    conditions: ReactionCondition[],
    ctx: ReactionContext,
  ): Promise<{ passed: boolean; details: Record<string, boolean> }> {
    const details: Record<string, boolean> = {};

    for (const cond of conditions) {
      const result = await this.evaluateCondition(cond, ctx);
      details[cond.type] = result;
      if (!result) {
        return { passed: false, details };
      }
    }

    return { passed: true, details };
  }

  // ─── Public: Evaluate Safety Gates ──────────────────────────────────────

  async evaluateSafetyGates(
    gates: SafetyGate[],
    ctx: ReactionContext,
  ): Promise<{ passed: boolean; details: Record<string, boolean> }> {
    const details: Record<string, boolean> = {};

    for (const gate of gates) {
      const result = await this.evaluateGate(gate, ctx);
      details[gate.type] = result;
      if (!result) {
        logger.warn('Safety gate FAILED', { gate: gate.type, pr: ctx.prNumber, repo: `${ctx.owner}/${ctx.repo}` });
        return { passed: false, details };
      }
    }

    return { passed: true, details };
  }

  // ─── Public: Check if PR is already merged/closed ───────────────────────

  async isPRAlreadyMerged(ctx: ReactionContext): Promise<boolean> {
    if (!ctx.prNumber) return false;
    const pr = await this.getPRState(ctx);
    return pr.merged || pr.state === 'closed';
  }

  // ─── Public: Extract linked issue numbers from PR body ──────────────────

  extractLinkedIssues(body: string | null | undefined): number[] {
    if (!body) return [];
    // Match: Fixes #N, Closes #N, Resolves #N (case-insensitive)
    const pattern = /(?:fix(?:es)?|close(?:s)?|resolve(?:s)?)\s+#(\d+)/gi;
    const issues: number[] = [];
    let match;
    while ((match = pattern.exec(body)) !== null) {
      issues.push(parseInt(match[1], 10));
    }
    return [...new Set(issues)];
  }

  // ─── Private: Condition Dispatch ────────────────────────────────────────

  private async evaluateCondition(cond: ReactionCondition, ctx: ReactionContext): Promise<boolean> {
    switch (cond.type) {
      case 'pr_approved': {
        if (!ctx.prNumber) return false;
        const reviews = await this.getReviews(ctx);
        return reviews.approved >= 1;
      }
      case 'ci_green': {
        if (!ctx.prNumber) return false;
        const checks = await this.getChecks(ctx);
        return checks.allPassed && checks.totalChecks > 0;
      }
      case 'has_linked_issue': {
        const pr = await this.getPRState(ctx);
        const issues = this.extractLinkedIssues(pr.body);
        return issues.length > 0;
      }
      case 'task_exists': {
        if (!ctx.prNumber && !ctx.issueNumber) return false;
        const ref = ctx.issueNumber || ctx.prNumber;
        const key = `task:issue:${ref}`;
        const exists = await this.redis.exists(key);
        return exists === 1;
      }
      case 'label_present': {
        const label = (cond.params?.label as string) || '';
        if (!label) return false;
        if (ctx.prNumber) {
          const pr = await this.getPRState(ctx);
          return pr.labels.includes(label);
        }
        // For issues, check payload directly
        const labels = (ctx.payload.labels as string[]) || [];
        return labels.includes(label);
      }
      case 'label_absent': {
        const label = (cond.params?.label as string) || '';
        if (!label) return true;
        if (ctx.prNumber) {
          const pr = await this.getPRState(ctx);
          return !pr.labels.includes(label);
        }
        const labels = (ctx.payload.labels as string[]) || [];
        return !labels.includes(label);
      }
      default:
        logger.warn('Unknown condition type', { type: cond.type });
        return false;
    }
  }

  // ─── Private: Safety Gate Dispatch ──────────────────────────────────────

  private async evaluateGate(gate: SafetyGate, ctx: ReactionContext): Promise<boolean> {
    switch (gate.type) {
      case 'all_checks_passed': {
        if (!ctx.prNumber) return false;
        const checks = await this.getChecks(ctx);
        return checks.allPassed && checks.totalChecks > 0;
      }
      case 'min_approvals': {
        if (!ctx.prNumber) return false;
        const count = (gate.params?.count as number) || 1;
        const reviews = await this.getReviews(ctx);
        return reviews.approved >= count;
      }
      case 'no_merge_conflicts': {
        if (!ctx.prNumber) return false;
        const pr = await this.getPRState(ctx);
        // GitHub returns null for mergeable while computing; treat as fail
        return pr.mergeable === true;
      }
      case 'no_label': {
        if (!ctx.prNumber) return true;
        const label = (gate.params?.label as string) || 'do-not-merge';
        const pr = await this.getPRState(ctx);
        return !pr.labels.includes(label);
      }
      case 'dod_gate_passed': {
        // DoD gate is checked by the deploy action; for reactions we just
        // verify the PR doesn't have a 'dod-failed' label
        if (!ctx.prNumber) return false;
        const pr = await this.getPRState(ctx);
        return !pr.labels.includes('dod-failed');
      }
      case 'comment_approved': {
        if (!ctx.prNumber) return false;
        return this.evaluateCommentApproved(ctx, gate.params);
      }
      case 'branch_up_to_date': {
        if (!ctx.prNumber) return false;
        const pr = await this.getPRState(ctx);
        return pr.mergeable_state === 'clean';
      }
      default:
        logger.warn('Unknown safety gate type', { type: gate.type });
        return false;
    }
  }

  // ─── Private: GitHub API Queries (with Redis cache) ─────────────────────

  private async getPRState(ctx: ReactionContext): Promise<PRState> {
    const cacheKey = `reaction:cache:pr:${ctx.owner}:${ctx.repo}:${ctx.prNumber}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) return JSON.parse(cached);

    const url = `${GITHUB_API}/repos/${ctx.owner}/${ctx.repo}/pulls/${ctx.prNumber}`;
    const data = await this.githubFetch(url);

    const state: PRState = {
      merged: data.merged ?? false,
      mergeable: data.mergeable ?? null,
      mergeable_state: data.mergeable_state ?? null,
      labels: (data.labels || []).map((l: any) => l.name),
      draft: data.draft ?? false,
      state: data.state ?? 'unknown',
      body: data.body ?? null,
    };

    await this.redis.setex(cacheKey, CACHE_TTL, JSON.stringify(state));
    return state;
  }

  private async getReviews(ctx: ReactionContext): Promise<ReviewSummary> {
    const cacheKey = `reaction:cache:reviews:${ctx.owner}:${ctx.repo}:${ctx.prNumber}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) return JSON.parse(cached);

    const url = `${GITHUB_API}/repos/${ctx.owner}/${ctx.repo}/pulls/${ctx.prNumber}/reviews`;
    const data = await this.githubFetch(url);

    // Only count latest review per user
    const latestByUser = new Map<string, string>();
    for (const review of (data as any[])) {
      if (review.state === 'APPROVED' || review.state === 'CHANGES_REQUESTED') {
        latestByUser.set(review.user.login, review.state);
      }
    }

    const summary: ReviewSummary = {
      approved: [...latestByUser.values()].filter(s => s === 'APPROVED').length,
      changesRequested: [...latestByUser.values()].filter(s => s === 'CHANGES_REQUESTED').length,
      reviewers: [...latestByUser.keys()],
    };

    await this.redis.setex(cacheKey, CACHE_TTL, JSON.stringify(summary));
    return summary;
  }

  private async getChecks(ctx: ReactionContext): Promise<ChecksSummary> {
    // We need the head SHA — get from PR state or payload
    const sha = (ctx.payload.head_sha as string) || (ctx.payload.commit_sha as string);
    if (!sha) {
      // Fetch from PR
      const url = `${GITHUB_API}/repos/${ctx.owner}/${ctx.repo}/pulls/${ctx.prNumber}`;
      const pr = await this.githubFetch(url);
      return this.getChecksForSha(ctx, pr.head?.sha);
    }
    return this.getChecksForSha(ctx, sha);
  }

  private async getChecksForSha(ctx: ReactionContext, sha: string): Promise<ChecksSummary> {
    if (!sha) return { allPassed: false, totalChecks: 0, failedChecks: ['no_sha'] };

    const cacheKey = `reaction:cache:checks:${ctx.owner}:${ctx.repo}:${sha}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) return JSON.parse(cached);

    const url = `${GITHUB_API}/repos/${ctx.owner}/${ctx.repo}/commits/${sha}/check-runs`;
    const data = await this.githubFetch(url);

    const checkRuns = data.check_runs || [];
    const failed = checkRuns
      .filter((cr: any) => cr.conclusion !== 'success' && cr.conclusion !== 'skipped' && cr.status === 'completed')
      .map((cr: any) => cr.name);

    const summary: ChecksSummary = {
      allPassed: failed.length === 0 && checkRuns.length > 0,
      totalChecks: checkRuns.length,
      failedChecks: failed,
    };

    await this.redis.setex(cacheKey, CACHE_TTL, JSON.stringify(summary));
    return summary;
  }

  private async evaluateCommentApproved(
    ctx: ReactionContext,
    params?: Record<string, unknown>,
  ): Promise<boolean> {
    const cacheKey = `reaction:cache:comment_approved:${ctx.owner}:${ctx.repo}:${ctx.prNumber}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) return JSON.parse(cached) as boolean;

    // Fetch all PR issue comments (not review objects — Architect posts plain comments)
    const commentsUrl = `${GITHUB_API}/repos/${ctx.owner}/${ctx.repo}/issues/${ctx.prNumber}/comments`;
    const comments = (await this.githubFetch(commentsUrl)) as Array<{
      body: string;
      created_at: string;
      user: { login: string };
    }>;

    // Find the most recent comment containing the Architect review header
    const reviewComments = comments
      .filter((c) => c.body.includes('## Architect Review'))
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    if (reviewComments.length === 0) {
      logger.info('comment_approved: no Architect Review comment found', { pr: ctx.prNumber });
      await this.redis.setex(cacheKey, CACHE_TTL, JSON.stringify(false));
      return false;
    }

    const latestReview = reviewComments[0];

    if (!latestReview.body.includes('[APPROVED]')) {
      logger.info('comment_approved: latest Architect Review is not [APPROVED]', { pr: ctx.prNumber });
      await this.redis.setex(cacheKey, CACHE_TTL, JSON.stringify(false));
      return false;
    }

    // Reviewer identity check — prevent unauthorized comments from triggering merge.
    // ARCHITECT_GITHUB_LOGINS env var (comma-separated) is the authoritative source.
    // params.reviewers from rules.ts is the fallback (used when env var is absent).
    const envLogins = (process.env.ARCHITECT_GITHUB_LOGINS || '').split(',').map(s => s.trim()).filter(Boolean);
    const paramReviewers = (params?.reviewers as string[] | undefined) ?? [];
    // env var takes precedence: if set, it is the sole source of truth
    const allowedReviewers = envLogins.length > 0 ? envLogins : paramReviewers;

    if (allowedReviewers.length === 0) {
      logger.warn('comment_approved: no reviewer configured (set ARCHITECT_GITHUB_LOGINS env var) — failing closed', {
        pr: ctx.prNumber,
      });
      await this.redis.setex(cacheKey, CACHE_TTL, JSON.stringify(false));
      return false;
    }

    if (!allowedReviewers.includes(latestReview.user.login)) {
      logger.warn('comment_approved: commenter not in allowed reviewers list', {
        pr: ctx.prNumber,
        commenter: latestReview.user.login,
        allowedReviewers,
      });
      await this.redis.setex(cacheKey, CACHE_TTL, JSON.stringify(false));
      return false;
    }

    // Approval comment must post-date the PR head commit (stale review guard)
    const prUrl = `${GITHUB_API}/repos/${ctx.owner}/${ctx.repo}/pulls/${ctx.prNumber}`;
    const pr = await this.githubFetch(prUrl);
    const headSha: string | undefined = pr.head?.sha;

    if (!headSha) {
      logger.warn('comment_approved: could not determine PR head SHA', { pr: ctx.prNumber });
      await this.redis.setex(cacheKey, CACHE_TTL, JSON.stringify(false));
      return false;
    }

    const commitUrl = `${GITHUB_API}/repos/${ctx.owner}/${ctx.repo}/commits/${headSha}`;
    const commit = await this.githubFetch(commitUrl);
    const commitDateStr: string | undefined =
      commit.commit?.committer?.date ?? commit.commit?.author?.date;

    if (!commitDateStr) {
      logger.warn('comment_approved: could not determine head commit date', { pr: ctx.prNumber, sha: headSha });
      await this.redis.setex(cacheKey, CACHE_TTL, JSON.stringify(false));
      return false;
    }

    const commentTime = new Date(latestReview.created_at).getTime();
    const commitTime = new Date(commitDateStr).getTime();
    const passed = commentTime > commitTime;

    logger.info('comment_approved result', {
      pr: ctx.prNumber,
      passed,
      commentAt: latestReview.created_at,
      commitAt: commitDateStr,
    });

    await this.redis.setex(cacheKey, CACHE_TTL, JSON.stringify(passed));
    return passed;
  }

  private async githubFetch(url: string): Promise<any> {
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${this.githubToken}`,
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'yclaw-reactions',
      },
    });

    if (!response.ok) {
      logger.error('GitHub API error', { url, status: response.status, statusText: response.statusText });
      throw new Error(`GitHub API ${response.status}: ${response.statusText}`);
    }

    return response.json();
  }
}
