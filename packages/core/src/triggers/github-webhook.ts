import type { EventBus } from './event.js';
import type { RepoRegistry } from '../config/repo-registry.js';
import { createLogger } from '../logging/logger.js';
import { getGitHubToken } from '../actions/github/app-auth.js';

const logger = createLogger('github-webhook');

/** Generate a correlation ID for tracing events through the pipeline. */
function makeCorrelationId(repo: string, ref: string | number): string {
  return `${repo}:${ref}:${Date.now()}`;
}

// ─── GitHub Webhook Handler ─────────────────────────────────────────────────
//
// Receives GitHub webhook POSTs and publishes structured events to the
// internal event bus. This is the bridge between GitHub's notification
// system and the agent event model.
//
// Security layers:
//   1. Repo allowlist — only repos in the registry trigger events
//   2. Branch filter  — CI events only fire for the repo's default branch
//   3. Assignee allowlist — issue_assigned only for known agent accounts
//   4. Idempotency — dedup via X-GitHub-Delivery header
//
// Supported events:
//   github:issue_assigned      — issue assigned to someone (Builder trigger)
//   github:issue_opened        — new issue created
//   github:pr_opened           — new PR opened (Architect trigger)
//   github:pr_review_submitted — review submitted on a PR
//   github:ci_pass             — CI workflow completed successfully (Deployer trigger)
//   github:ci_fail             — CI workflow failed
//
// GitHub must be configured to POST to /github/webhook with a secret.
// Signature verification is handled by the WebhookServer middleware.
//

/** Max delivery IDs to retain for idempotency dedup. */
const MAX_DELIVERY_CACHE = 1000;

// ─── Types ──────────────────────────────────────────────────────────────────

interface GitHubWebhookPayload {
  action?: string;
  /** Present on 'labeled'/'unlabeled' events — the specific label that was added/removed. */
  label?: { name: string };
  issue?: {
    number: number;
    title: string;
    body: string | null;
    html_url: string;
    labels: Array<{ name: string }>;
    assignee?: { login: string } | null;
    assignees?: Array<{ login: string }>;
    /** Present when the issue is actually a pull request (issue_comment webhook). */
    pull_request?: { url: string; html_url: string };
    /** 'open' or 'closed' — present on all issue/PR objects. */
    state?: string;
  };
  comment?: {
    id: number;
    body: string;
    html_url: string;
    user: { login: string };
    issue_url: string;
  };
  pull_request?: {
    number: number;
    title: string;
    body: string | null;
    html_url: string;
    head: { ref: string; sha: string };
    base: { ref: string };
    draft: boolean;
    labels: Array<{ name: string }>;
    merged: boolean;
  };
  review?: {
    state: string;
    body: string | null;
    user: { login: string };
    html_url: string;
  };
  workflow_run?: {
    id: number;
    name: string;
    conclusion: string | null;
    head_branch: string;
    head_sha: string;
    html_url: string;
  };
  repository: {
    name: string;
    full_name: string;
    owner: { login: string };
  };
  sender: {
    login: string;
  };
}

// ─── Options ────────────────────────────────────────────────────────────────

export interface GitHubWebhookOptions {
  /** Live repo registry for allowlist checks. */
  registry?: RepoRegistry;
  /** GitHub usernames whose issue assignments should trigger agents. */
  allowedAssignees?: Set<string>;
}

// ─── Handler ────────────────────────────────────────────────────────────────

export class GitHubWebhookHandler {
  private eventBus: EventBus;

  /** Live repo registry — queried on each webhook for up-to-date allowlist. */
  private registry: RepoRegistry | null;

  /** GitHub usernames that trigger issue_assigned events. */
  private allowedAssignees: Set<string>;

  /** Recent X-GitHub-Delivery IDs for idempotency. */
  private recentDeliveries = new Set<string>();

  constructor(eventBus: EventBus, options?: GitHubWebhookOptions) {
    this.eventBus = eventBus;

    // Live registry — repos registered at runtime are immediately visible
    this.registry = options?.registry ?? null;

    // Allowed assignees from options or AGENT_ASSIGNEES env var
    this.allowedAssignees = options?.allowedAssignees ?? new Set(
      (process.env.AGENT_ASSIGNEES || '').split(',').map(s => s.trim()).filter(Boolean),
    );


    logger.info('GitHubWebhookHandler initialized', {
      registeredRepos: this.registry?.size ?? 0,
      allowedAssignees: this.allowedAssignees.size,
    });
  }

  /**
   * Process an incoming GitHub webhook payload.
   * Called by the Express route handler after signature verification.
   *
   * @param eventType - The X-GitHub-Event header value
   * @param payload - The parsed JSON body
   * @param deliveryId - The X-GitHub-Delivery header (for idempotency)
   */
  async handleWebhook(
    eventType: string,
    payload: GitHubWebhookPayload,
    deliveryId?: string,
  ): Promise<{ processed: boolean; event?: string }> {
    // Idempotency: reject duplicate deliveries
    if (deliveryId) {
      if (this.recentDeliveries.has(deliveryId)) {
        logger.info('Duplicate delivery, skipping', { deliveryId });
        return { processed: false };
      }
      this.recentDeliveries.add(deliveryId);
      if (this.recentDeliveries.size > MAX_DELIVERY_CACHE * 2) {
        const entries = [...this.recentDeliveries];
        this.recentDeliveries = new Set(entries.slice(-MAX_DELIVERY_CACHE));
      }
    }

    const repoFullName = payload.repository?.full_name || 'unknown';

    // Repo allowlist (fail-closed): no registry or empty = block all
    if (!this.registry || this.registry.size === 0) {
      logger.warn('No repos in registry — blocking all webhooks (fail-closed)', { repo: repoFullName });
      return { processed: false };
    }
    if (!this.registry.has(repoFullName)) {
      logger.warn('Webhook from unregistered repo, ignoring', { repo: repoFullName });
      return { processed: false };
    }

    logger.info('Processing GitHub webhook', {
      event: eventType,
      action: payload.action,
      repo: repoFullName,
      sender: payload.sender?.login,
    });

    switch (eventType) {
      case 'issues':
        return this.handleIssue(payload);
      case 'issue_comment':
        return this.handleIssueComment(payload);
      case 'pull_request':
        return this.handlePullRequest(payload);
      case 'pull_request_review':
        return this.handlePullRequestReview(payload);
      case 'workflow_run':
        return this.handleWorkflowRun(payload);
      default:
        logger.info('Ignoring unhandled GitHub event', { event: eventType });
        return { processed: false };
    }
  }

  // ─── Issue Events ───────────────────────────────────────────────────────

  private async handleIssue(
    payload: GitHubWebhookPayload,
  ): Promise<{ processed: boolean; event?: string }> {
    const { action, issue, repository } = payload;
    if (!issue) return { processed: false };

    if (action === 'assigned' && issue.assignee) {
      // Assignee allowlist (fail-closed): no allowlist = block all assignments
      if (this.allowedAssignees.size === 0) {
        logger.warn('AGENT_ASSIGNEES not configured — blocking issue assignment (fail-closed)', {
          assignee: issue.assignee.login,
          issue: issue.number,
        });
        return { processed: false };
      }
      if (!this.allowedAssignees.has(issue.assignee.login)) {
        logger.info('Issue assigned to non-agent user, skipping', {
          assignee: issue.assignee.login,
          issue: issue.number,
          repo: repository.full_name,
        });
        return { processed: false };
      }

      const correlationId = makeCorrelationId(repository.full_name, issue.number);
      await this.eventBus.publish('github', 'issue_assigned', {
        issue_number: issue.number,
        title: issue.title,
        body: issue.body || '',
        url: issue.html_url,
        labels: issue.labels.map(l => l.name),
        assignee: issue.assignee.login,
        owner: repository.owner.login,
        repo: repository.name,
        repo_full: repository.full_name,
      }, correlationId);

      logger.info('Published github:issue_assigned', {
        issue: issue.number,
        assignee: issue.assignee.login,
        repo: repository.full_name,
      });

      return { processed: true, event: 'github:issue_assigned' };
    }

    if (action === 'opened') {
      await this.eventBus.publish('github', 'issue_opened', {
        issue_number: issue.number,
        title: issue.title,
        body: issue.body || '',
        url: issue.html_url,
        labels: issue.labels.map(l => l.name),
        owner: repository.owner.login,
        repo: repository.name,
        repo_full: repository.full_name,
      }, makeCorrelationId(repository.full_name, issue.number));

      return { processed: true, event: 'github:issue_opened' };
    }

    // Issue labeled — allows ReactionsManager to auto-assign issues that
    // Issue closed — publish event so ReactionsManager can clean up tasks
    if (action === 'closed') {
      await this.eventBus.publish('github', 'issue_closed', {
        issue_number: issue.number,
        title: issue.title,
        url: issue.html_url,
        labels: issue.labels.map(l => l.name),
        owner: repository.owner.login,
        repo: repository.name,
        repo_full: repository.full_name,
      }, makeCorrelationId(repository.full_name, issue.number));

      return { processed: true, event: 'github:issue_closed' };
    }

    // were created without the right labels (e.g., label added after creation).
    if (action === 'labeled' && payload.label) {
      await this.eventBus.publish('github', 'issue_labeled', {
        issue_number: issue.number,
        title: issue.title,
        body: issue.body || '',
        url: issue.html_url,
        labels: issue.labels.map(l => l.name),
        label_added: payload.label.name,
        owner: repository.owner.login,
        repo: repository.name,
        repo_full: repository.full_name,
      }, makeCorrelationId(repository.full_name, issue.number));

      return { processed: true, event: 'github:issue_labeled' };
    }

    return { processed: false };
  }

  // ─── Issue Comment Events ────────────────────────────────────────────────
  //
  // Handles issue_comment webhooks to detect Architect review comments on PRs.
  // Architect posts "## Architect Review\n[APPROVED]" or "[CHANGES REQUESTED]"
  // as a PR comment (not a formal review object) — this bridges that comment
  // into the internal event bus as github:pr_review_comment.

  private async handleIssueComment(
    payload: GitHubWebhookPayload,
  ): Promise<{ processed: boolean; event?: string }> {
    const { action, issue, comment, repository } = payload;

    // Only process newly created comments
    if (action !== 'created') return { processed: false };
    if (!issue || !comment) return { processed: false };

    // Ignore Journaler-generated comments (loop prevention)
    if (comment.body.includes('<!-- yclaw-journaler -->')) return { processed: false };

    // Only process comments on PRs (issues have no pull_request field)
    if (!issue.pull_request) return { processed: false };

    // Only process Architect review comments
    if (!comment.body.includes('## Architect Review')) return { processed: false };

    // Skip review comments on closed/merged PRs — nothing to fix after a PR is closed
    if (issue.state === 'closed') {
      logger.info('Skipping Architect review comment on closed PR', {
        pr: issue.number,
        repo: repository.full_name,
        reason: 'pr_closed',
      });
      return { processed: false };
    }

    const reviewState = comment.body.includes('[APPROVED]')
      ? 'approved'
      : comment.body.includes('[CHANGES REQUESTED]')
        ? 'changes_requested'
        : null;

    if (!reviewState) {
      logger.info('Architect review comment has no recognized status, skipping', {
        pr: issue.number,
        repo: repository.full_name,
      });
      return { processed: false };
    }

    await this.eventBus.publish('github', 'pr_review_comment', {
      pr_number: issue.number,
      review_state: reviewState,
      comment_body: comment.body,
      commenter: comment.user.login,
      comment_url: comment.html_url,
      pr_state: issue.state ?? 'open',
      owner: repository.owner.login,
      repo: repository.name,
      repo_full: repository.full_name,
    }, makeCorrelationId(repository.full_name, `pr-${issue.number}`));

    logger.info('Published github:pr_review_comment', {
      pr: issue.number,
      review_state: reviewState,
      commenter: comment.user.login,
      repo: repository.full_name,
    });

    return { processed: true, event: 'github:pr_review_comment' };
  }

  // ─── Pull Request Events ────────────────────────────────────────────────

  private async handlePullRequest(
    payload: GitHubWebhookPayload,
  ): Promise<{ processed: boolean; event?: string }> {
    const { action, pull_request, repository } = payload;
    if (!pull_request) return { processed: false };

    if (action === 'opened' || action === 'ready_for_review') {
      // Skip draft PRs unless they're being marked ready
      if (pull_request.draft && action !== 'ready_for_review') {
        return { processed: false };
      }

      await this.eventBus.publish('github', 'pr_opened', {
        pr_number: pull_request.number,
        title: pull_request.title,
        body: pull_request.body || '',
        url: pull_request.html_url,
        head_branch: pull_request.head.ref,
        head_sha: pull_request.head.sha,
        base_branch: pull_request.base.ref,
        labels: pull_request.labels.map(l => l.name),
        owner: repository.owner.login,
        repo: repository.name,
        repo_full: repository.full_name,
      }, makeCorrelationId(repository.full_name, `pr-${pull_request.number}`));

      logger.info('Published github:pr_opened', {
        pr: pull_request.number,
        branch: pull_request.head.ref,
        repo: repository.full_name,
      });

      return { processed: true, event: 'github:pr_opened' };
    }

    // ─── PR Synchronize (new commits pushed) → re-review trigger ──────
    if (action === 'synchronize') {
      await this.eventBus.publish('github', 'pr_updated', {
        pr_number: pull_request.number,
        title: pull_request.title,
        url: pull_request.html_url,
        head_branch: pull_request.head.ref,
        head_sha: pull_request.head.sha,
        base_branch: pull_request.base.ref,
        labels: pull_request.labels.map(l => l.name),
        owner: repository.owner.login,
        repo: repository.name,
        repo_full: repository.full_name,
      }, makeCorrelationId(repository.full_name, `pr-${pull_request.number}`));

      logger.info('Published github:pr_updated (synchronize)', {
        pr: pull_request.number,
        branch: pull_request.head.ref,
        repo: repository.full_name,
      });

      return { processed: true, event: 'github:pr_updated' };
    }

    // ─── PR Merged (closed + merged === true) ─────────────────────────
    if (action === 'closed' && pull_request.merged) {
      await this.eventBus.publish('github', 'pr_merged', {
        pr_number: pull_request.number,
        title: pull_request.title,
        pr_body: pull_request.body || '',
        url: pull_request.html_url,
        head_branch: pull_request.head.ref,
        head_sha: pull_request.head.sha,
        base_branch: pull_request.base.ref,
        labels: pull_request.labels.map(l => l.name),
        owner: repository.owner.login,
        repo: repository.name,
        repo_full: repository.full_name,
      }, makeCorrelationId(repository.full_name, `pr-${pull_request.number}`));

      logger.info('Published github:pr_merged', {
        pr: pull_request.number,
        branch: pull_request.head.ref,
        repo: repository.full_name,
      });

      return { processed: true, event: 'github:pr_merged' };
    }

    return { processed: false };
  }

  // ─── Pull Request Review Events ─────────────────────────────────────────

  private async handlePullRequestReview(
    payload: GitHubWebhookPayload,
  ): Promise<{ processed: boolean; event?: string }> {
    const { action, review, pull_request, repository } = payload;
    if (!review || !pull_request) return { processed: false };

    if (action === 'submitted') {
      await this.eventBus.publish('github', 'pr_review_submitted', {
        pr_number: pull_request.number,
        pr_url: pull_request.html_url,
        review_state: review.state,
        reviewer: review.user.login,
        review_body: review.body || '',
        review_url: review.html_url,
        head_branch: pull_request.head.ref,
        head_sha: pull_request.head.sha,
        owner: repository.owner.login,
        repo: repository.name,
        repo_full: repository.full_name,
      }, makeCorrelationId(repository.full_name, `pr-${pull_request.number}`));

      return { processed: true, event: 'github:pr_review_submitted' };
    }

    return { processed: false };
  }

  // ─── Workflow Run Events (CI/CD) ────────────────────────────────────────

  private async handleWorkflowRun(
    payload: GitHubWebhookPayload,
  ): Promise<{ processed: boolean; event?: string }> {
    const { action, workflow_run, repository } = payload;
    if (!workflow_run) return { processed: false };

    // Only handle completed workflow runs
    if (action !== 'completed') return { processed: false };

    // CI pass events only fire for the default branch (Deployer trigger).
    // CI fail events fire for ALL branches when REACTION_LOOP_ENABLED=true
    // (so Builder can auto-fix PR CI failures).
    const repoConfig = this.registry?.getByFullName(repository.full_name);
    const defaultBranch = repoConfig?.github.default_branch || 'main';
    const isDefaultBranch = workflow_run.head_branch === defaultBranch;
    const reactionLoopEnabled = process.env.REACTION_LOOP_ENABLED === 'true';

    // Determine if this is a true CI (Check) failure or just a deploy failure.
    // The workflow may contain multiple jobs: Check, Deploy Core, Deploy Mission Control.
    // Builder should only be triggered when the "Check" job fails, not deploy jobs.
    // A workflow with conclusion=failure where only deploy jobs failed is NOT a CI failure.
    let eventType: 'ci_pass' | 'ci_fail' | 'deploy_fail';
    if (workflow_run.conclusion === 'success') {
      eventType = 'ci_pass';
    } else {
      // Query GitHub API for individual job results to distinguish Check vs Deploy failures
      eventType = await this.classifyWorkflowFailure(
        repository.owner.login,
        repository.name,
        workflow_run.id,
      );
    }

    // deploy_fail: log it but don't trigger Builder — this is Deployer/infra territory
    if (eventType === 'deploy_fail') {
      logger.info('Workflow failed but only deploy jobs failed (Check passed) — skipping ci_fail', {
        workflow: workflow_run.name,
        branch: workflow_run.head_branch,
        repo: repository.full_name,
        url: workflow_run.html_url,
      });
      return { processed: false };
    }

    // ci_pass: only default branch (Deployer needs this for deploy decisions)
    // ci_fail: default branch always, PR branches only if reaction loop is enabled
    if (eventType === 'ci_pass' && !isDefaultBranch) {
      logger.info('CI pass not on default branch, skipping', {
        branch: workflow_run.head_branch,
        defaultBranch,
        repo: repository.full_name,
      });
      return { processed: false };
    }

    if (eventType === 'ci_fail' && !isDefaultBranch && !reactionLoopEnabled) {
      logger.info('CI fail on PR branch, reaction loop disabled, skipping', {
        branch: workflow_run.head_branch,
        repo: repository.full_name,
      });
      return { processed: false };
    }

    // Resolve PR URL for ci_pass events on default branch.
    // The pr_required DoD gate in deploy:execute needs this for production deployments.
    let pr_url: string | null = null;
    if (eventType === 'ci_pass' && isDefaultBranch) {
      try {
        const ghToken = await getGitHubToken();
        const commitsUrl = `https://api.github.com/repos/${repository.owner.login}/${repository.name}/commits/${workflow_run.head_sha}/pulls`;
        const prResponse = await fetch(commitsUrl, {
          headers: {
            'Accept': 'application/vnd.github+json',
            'Authorization': `Bearer ${ghToken}`,
            'X-GitHub-Api-Version': '2022-11-28',
          },
        });
        if (prResponse.ok) {
          const prs = (await prResponse.json()) as Array<{
            merged_at: string | null;
            base: { ref: string };
            html_url: string;
          }>;
          const mergedPr = prs.find(pr => pr.merged_at && pr.base.ref === defaultBranch);
          if (mergedPr) {
            pr_url = mergedPr.html_url;
            logger.info('Resolved PR URL for ci_pass', { pr_url, commit: workflow_run.head_sha });
          }
        }
      } catch (err) {
        logger.warn('Failed to resolve PR URL for ci_pass, continuing without it', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    await this.eventBus.publish('github', eventType, {
      workflow: workflow_run.name,
      conclusion: workflow_run.conclusion,
      branch: workflow_run.head_branch,
      commit_sha: workflow_run.head_sha,
      url: workflow_run.html_url,
      owner: repository.owner.login,
      repo: repository.name,
      repo_full: repository.full_name,
      pr_url,
    }, makeCorrelationId(repository.full_name, `ci-${workflow_run.head_branch}`));

    logger.info(`Published github:${eventType}`, {
      workflow: workflow_run.name,
      conclusion: workflow_run.conclusion,
      branch: workflow_run.head_branch,
      repo: repository.full_name,
    });

    return { processed: true, event: `github:${eventType}` };
  }

  // ─── Classify Workflow Failure: Check vs Deploy ─────────────────────────
  //
  // When a workflow run fails, query the GitHub API for individual job results.
  // If the "Check" job passed and only deploy jobs failed, this is a deploy_fail
  // (Deployer/infra domain), not a ci_fail (Builder domain).
  //
  // This prevents Builder from entering CI fix loops when deploy IAM permissions
  // or Docker build issues cause workflow failures unrelated to code quality.
  //
  private async classifyWorkflowFailure(
    owner: string,
    repo: string,
    runId: number,
  ): Promise<'ci_fail' | 'deploy_fail'> {
    try {
      const ghToken = await getGitHubToken();
      const url = `https://api.github.com/repos/${owner}/${repo}/actions/runs/${runId}/jobs`;
      const response = await fetch(url, {
        headers: {
          'Accept': 'application/vnd.github+json',
          'Authorization': `Bearer ${ghToken}`,
          'X-GitHub-Api-Version': '2022-11-28',
        },
      });

      if (!response.ok) {
        logger.warn('Failed to fetch workflow jobs, defaulting to ci_fail', {
          status: response.status,
          runId,
        });
        return 'ci_fail';
      }

      const data = (await response.json()) as {
        jobs: Array<{
          name: string;
          conclusion: string | null;
          status: string;
        }>;
      };

      // Identify check jobs vs deploy jobs by name pattern.
      // Check/lint/test jobs are CI (Builder's domain).
      // Deploy jobs are infrastructure (Deployer's domain).
      const DEPLOY_JOB_PATTERNS = /^deploy/i;
      const checkJobs = data.jobs.filter(j => !DEPLOY_JOB_PATTERNS.test(j.name));
      const deployJobs = data.jobs.filter(j => DEPLOY_JOB_PATTERNS.test(j.name));

      const checkJobsFailed = checkJobs.some(
        j => j.status === 'completed' && j.conclusion !== 'success' && j.conclusion !== 'skipped',
      );
      const deployJobsFailed = deployJobs.some(
        j => j.status === 'completed' && j.conclusion !== 'success' && j.conclusion !== 'skipped',
      );

      logger.info('Workflow failure classification', {
        runId,
        checkJobs: checkJobs.map(j => `${j.name}:${j.conclusion}`),
        deployJobs: deployJobs.map(j => `${j.name}:${j.conclusion}`),
        checkJobsFailed,
        deployJobsFailed,
      });

      // If check jobs all passed but deploy jobs failed → deploy_fail
      if (!checkJobsFailed && deployJobsFailed) {
        return 'deploy_fail';
      }

      // Any check job failure → ci_fail (Builder's problem)
      return 'ci_fail';
    } catch (err) {
      logger.warn('Error classifying workflow failure, defaulting to ci_fail', {
        error: err instanceof Error ? err.message : String(err),
        runId,
      });
      // Fail open: if we can't classify, assume ci_fail so Builder investigates
      return 'ci_fail';
    }
  }
}
