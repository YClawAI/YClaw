import { createLogger } from "../logging/logger.js";
import type { Redis } from "ioredis";
import { GITHUB_ORG_DEFAULTS } from '../config/github-defaults.js';

const logger = createLogger("reconciler");

// --- Types ---

export interface ReconcilerConfig {
  owner: string;
  repo: string;
  maxActionsPerCycle: number;       // default 5
  cycleLockTTLSeconds: number;      // default 720 (12 min > 10 min interval)
  stalePRThresholdHours: number;    // default 48
  orphanGracePeriodMinutes: number; // default 30 — dont redispatch brand new issues
  staleApprovalEnabled: boolean;
  orphanedIssueEnabled: boolean;
  branchBehindEnabled: boolean;
  readyToMergeEnabled: boolean;
  stuckPREnabled: boolean;
  dryRun: boolean;
}

export const DEFAULT_RECONCILER_CONFIG: ReconcilerConfig = {
  owner: GITHUB_ORG_DEFAULTS.owner,
  repo: GITHUB_ORG_DEFAULTS.repo,
  maxActionsPerCycle: 5,
  cycleLockTTLSeconds: 720,
  stalePRThresholdHours: 48,
  orphanGracePeriodMinutes: 30,
  staleApprovalEnabled: true,
  orphanedIssueEnabled: true,
  branchBehindEnabled: true,
  readyToMergeEnabled: true,
  stuckPREnabled: true,
  dryRun: false,
};

export type DetectionType =
  | "orphaned_issue"
  | "stale_approval"
  | "branch_behind"
  | "ready_to_merge"
  | "stuck_pr"
  | "builder_thrashing"
  | "zombie_ci";

export interface Detection {
  type: DetectionType;
  target: { owner: string; repo: string; number: number; kind: "pr" | "issue" };
  reason: string;
  metadata?: Record<string, unknown>;
}

export interface ReconcilerResult {
  cycleId: string;
  startedAt: string;
  completedAt: string;
  detections: Detection[];
  emitted: Detection[];    // subset that was acted on (within budget)
  skipped: Detection[];    // over budget or lock-blocked
  errors: Array<{ detection: Detection; error: string }>;
}

// --- Deps interface ---

export interface ReconcilerDeps {
  redis: Redis;
  githubToken: string;
  /** Callback to emit events to the EventBus for ReactionsManager to handle */
  emitEvent: (
    source: string,
    type: string,
    data: Record<string, unknown>,
    correlationId?: string,
  ) => Promise<void>;
  /** Optional Slack notification */
  notifySlack?: (channel: string, text: string) => Promise<void>;
  /** Check if Builder circuit breaker is open for a project */
  isCircuitBreakerOpen?: (projectKey: string) => boolean;
}

// --- Constants ---

const LOCK_PREFIX = "yclaw:action";
const CYCLE_LOCK_KEY = "reconciler:cycle:lock";
const EXCLUDED_LABELS = ["human-only", "stalled", "do-not-merge", "archived"];

// --- GitHub API Types (minimal) ---

interface GitHubPR {
  number: number;
  title: string;
  state: string;
  draft: boolean;
  mergeable: boolean | null;
  mergeable_state: string | null;
  updated_at: string;
  created_at: string;
  labels: Array<{ name: string }>;
  head: { sha: string; ref: string };
  base: { ref: string };
  assignees: Array<{ login: string }>;
}

interface GitHubIssue {
  number: number;
  title: string;
  state: string;
  created_at: string;
  updated_at: string;
  labels: Array<{ name: string }>;
  assignees: Array<{ login: string }>;
  pull_request?: unknown;
}

interface GitHubComment {
  body: string;
  created_at: string;
  user: { login: string };
}

interface GitHubCommit {
  sha: string;
  commit: {
    committer: { date: string };
    author: { date: string };
  };
}

interface GitHubCheckRun {
  name: string;
  status: string;
  conclusion: string | null;
  started_at: string;
}

// --- PRReconciler ---

export class PRReconciler {
  private readonly config: ReconcilerConfig;
  private readonly deps: ReconcilerDeps;
  private actionsBudget: number;

  constructor(deps: ReconcilerDeps, config?: Partial<ReconcilerConfig>) {
    this.deps = deps;
    this.config = { ...DEFAULT_RECONCILER_CONFIG, ...config };
    this.actionsBudget = this.config.maxActionsPerCycle;
  }

  /**
   * Run one reconciliation cycle. This is the main entry point.
   * Returns a structured result for observability.
   */
  async runCycle(): Promise<ReconcilerResult> {
    const cycleId = `recon-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const result: ReconcilerResult = {
      cycleId,
      startedAt: new Date().toISOString(),
      completedAt: "",
      detections: [],
      emitted: [],
      skipped: [],
      errors: [],
    };

    // Acquire global cycle lock — only one reconciler instance at a time
    const lockAcquired = await this.deps.redis.set(
      CYCLE_LOCK_KEY,
      cycleId,
      "EX",
      this.config.cycleLockTTLSeconds,
      "NX",
    );
    if (!lockAcquired) {
      logger.info("Reconciler cycle skipped — another instance is running");
      result.completedAt = new Date().toISOString();
      return result;
    }

    this.actionsBudget = this.config.maxActionsPerCycle;

    try {
      logger.info("Reconciler cycle starting", { cycleId });

      const openPRs = await this.fetchOpenPRs();
      const openIssues = await this.fetchOpenIssues();

      // Detection order matters:
      // 1. Stale approvals before ready-to-merge (updating branch invalidates approval)
      // 2. Ready-to-merge
      // 3. Branch behind
      // 4. Orphaned issues
      // 5. Stuck PRs (alerts only)
      // 6. Zombie CI
      // 7. Builder thrashing

      if (this.config.staleApprovalEnabled) {
        const stale = await this.detectStaleApprovals(openPRs);
        result.detections.push(...stale);
      }

      if (this.config.readyToMergeEnabled) {
        const ready = await this.detectReadyToMerge(openPRs);
        result.detections.push(...ready);
      }

      if (this.config.branchBehindEnabled) {
        const behind = await this.detectBranchBehind(openPRs);
        result.detections.push(...behind);
      }

      if (this.config.orphanedIssueEnabled) {
        const orphans = await this.detectOrphanedIssues(openIssues);
        result.detections.push(...orphans);
      }

      if (this.config.stuckPREnabled) {
        const stuck = await this.detectStuckPRs(openPRs);
        result.detections.push(...stuck);
      }

      const zombies = await this.detectZombieCI(openPRs);
      result.detections.push(...zombies);

      const thrashing = await this.detectBuilderThrashing(openPRs);
      result.detections.push(...thrashing);

      // Emit events for detections (within budget)
      for (const detection of result.detections) {
        if (this.actionsBudget <= 0) {
          result.skipped.push(detection);
          continue;
        }

        // Check per-resource lock — skip if ReactionsManager is already handling
        const resourceLockKey = `${LOCK_PREFIX}:${detection.target.owner}:${detection.target.repo}:${detection.target.number}`;
        const resourceLocked = await this.deps.redis.exists(resourceLockKey);
        if (resourceLocked) {
          logger.debug("Resource locked, skipping", {
            detection: detection.type,
            number: detection.target.number,
          });
          result.skipped.push(detection);
          continue;
        }

        if (!this.config.dryRun) {
          // Acquire resource lock before emitting
          await this.deps.redis.set(resourceLockKey, cycleId, "EX", 300); // 5 min TTL
        }

        try {
          await this.emitDetection(detection, cycleId);
          result.emitted.push(detection);
          this.actionsBudget--;
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          result.errors.push({ detection, error: errMsg });
          logger.error("Failed to emit detection", { detection, error: errMsg });
        }
      }

      logger.info("Reconciler cycle complete", {
        cycleId,
        detected: result.detections.length,
        emitted: result.emitted.length,
        skipped: result.skipped.length,
        errors: result.errors.length,
      });

      if (result.emitted.length > 0 && this.deps.notifySlack) {
        const summary = result.emitted
          .map((d) => `• ${d.type}: #${d.target.number} — ${d.reason}`)
          .join("\n");
        await this.deps
          .notifySlack("C0000000004", `🔄 Reconciler cycle ${cycleId}\n${summary}`)
          .catch(() => {});
      }
    } finally {
      await this.deps.redis.del(CYCLE_LOCK_KEY);
      result.completedAt = new Date().toISOString();
    }

    return result;
  }

  // --- Detection Methods ---

  /**
   * Detect PRs where the head commit is newer than the latest [APPROVED] Architect comment.
   * These need Architect re-review before they can merge.
   */
  private async detectStaleApprovals(prs: GitHubPR[]): Promise<Detection[]> {
    const detections: Detection[] = [];

    for (const pr of prs) {
      if (pr.draft) continue;
      if (this.hasExcludedLabel(pr)) continue;

      try {
        const comments = await this.githubFetch<GitHubComment[]>(
          `/repos/${this.config.owner}/${this.config.repo}/issues/${pr.number}/comments`,
        );

        const approvalComments = comments
          .filter((c) => c.body.includes("## Architect Review") && c.body.includes("[APPROVED]"))
          .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

        if (approvalComments.length === 0) continue;

        const latestApproval = approvalComments[0];
        const approvalTime = new Date(latestApproval.created_at).getTime();

        const commits = await this.githubFetch<GitHubCommit[]>(
          `/repos/${this.config.owner}/${this.config.repo}/pulls/${pr.number}/commits`,
        );
        if (commits.length === 0) continue;

        const headCommit = commits[commits.length - 1];
        const commitTime = new Date(headCommit.commit.committer.date).getTime();

        if (commitTime > approvalTime) {
          detections.push({
            type: "stale_approval",
            target: {
              owner: this.config.owner,
              repo: this.config.repo,
              number: pr.number,
              kind: "pr",
            },
            reason: `Head commit (${headCommit.sha.slice(0, 7)}) is newer than latest approval`,
            metadata: {
              approvalAt: latestApproval.created_at,
              commitAt: headCommit.commit.committer.date,
              headSha: headCommit.sha,
            },
          });
        }
      } catch (err) {
        logger.warn("Error checking stale approval", { pr: pr.number, error: String(err) });
      }
    }

    return detections;
  }

  /**
   * Detect PRs that are ready to merge: CI green + fresh approval + clean mergeable state.
   */
  private async detectReadyToMerge(prs: GitHubPR[]): Promise<Detection[]> {
    const detections: Detection[] = [];

    for (const pr of prs) {
      if (pr.draft) continue;
      if (this.hasExcludedLabel(pr)) continue;
      if (pr.mergeable_state !== "clean") continue;

      try {
        const comments = await this.githubFetch<GitHubComment[]>(
          `/repos/${this.config.owner}/${this.config.repo}/issues/${pr.number}/comments`,
        );

        const approvalComments = comments
          .filter((c) => c.body.includes("## Architect Review") && c.body.includes("[APPROVED]"))
          .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

        if (approvalComments.length === 0) continue;

        const commits = await this.githubFetch<GitHubCommit[]>(
          `/repos/${this.config.owner}/${this.config.repo}/pulls/${pr.number}/commits`,
        );
        if (commits.length === 0) continue;

        const headCommit = commits[commits.length - 1];
        const commitTime = new Date(headCommit.commit.committer.date).getTime();
        const approvalTime = new Date(approvalComments[0].created_at).getTime();

        if (approvalTime <= commitTime) continue; // stale approval

        const checkRuns = await this.githubFetch<{ check_runs: GitHubCheckRun[] }>(
          `/repos/${this.config.owner}/${this.config.repo}/commits/${pr.head.sha}/check-runs`,
        );

        const allPassed =
          checkRuns.check_runs.length > 0 &&
          checkRuns.check_runs.every(
            (cr) =>
              cr.conclusion === "success" ||
              cr.conclusion === "skipped" ||
              cr.status !== "completed",
          );

        if (!allPassed) continue;

        detections.push({
          type: "ready_to_merge",
          target: {
            owner: this.config.owner,
            repo: this.config.repo,
            number: pr.number,
            kind: "pr",
          },
          reason: `CI green, approved by ${approvalComments[0].user.login}, mergeable`,
          metadata: { headSha: pr.head.sha, reviewer: approvalComments[0].user.login },
        });
      } catch (err) {
        logger.warn("Error checking ready-to-merge", { pr: pr.number, error: String(err) });
      }
    }

    return detections;
  }

  /**
   * Detect PRs that are approved + CI green but branch is behind the base branch.
   */
  private async detectBranchBehind(prs: GitHubPR[]): Promise<Detection[]> {
    const detections: Detection[] = [];

    for (const pr of prs) {
      if (pr.draft) continue;
      if (this.hasExcludedLabel(pr)) continue;
      if (pr.mergeable_state !== "behind") continue;

      detections.push({
        type: "branch_behind",
        target: {
          owner: this.config.owner,
          repo: this.config.repo,
          number: pr.number,
          kind: "pr",
        },
        reason: `Branch ${pr.head.ref} is behind master`,
        metadata: { branch: pr.head.ref, mergeableState: pr.mergeable_state },
      });
    }

    return detections;
  }

  /**
   * Detect open issues with no assignee that are past the grace period.
   * These should be dispatched to Builder.
   */
  private async detectOrphanedIssues(issues: GitHubIssue[]): Promise<Detection[]> {
    const detections: Detection[] = [];
    const gracePeriodMs = this.config.orphanGracePeriodMinutes * 60 * 1000;

    for (const issue of issues) {
      if (issue.assignees && issue.assignees.length > 0) continue;
      if (issue.labels.some((l) => EXCLUDED_LABELS.includes(l.name))) continue;
      if (issue.pull_request) continue; // issues endpoint includes PRs

      const age = Date.now() - new Date(issue.created_at).getTime();
      if (age < gracePeriodMs) continue;

      const projectKey = `${this.config.owner}/${this.config.repo}`;
      if (this.deps.isCircuitBreakerOpen?.(projectKey)) {
        logger.info("Skipping orphaned issue — circuit breaker open", { issue: issue.number });
        continue;
      }

      detections.push({
        type: "orphaned_issue",
        target: {
          owner: this.config.owner,
          repo: this.config.repo,
          number: issue.number,
          kind: "issue",
        },
        reason: `Open issue with no assignee, created ${Math.round(age / 60000)}min ago`,
        metadata: { title: issue.title, createdAt: issue.created_at },
      });
    }

    return detections;
  }

  /**
   * Detect PRs with no activity for > stalePRThresholdHours.
   * These are flagged for human attention via Slack alert.
   */
  private async detectStuckPRs(prs: GitHubPR[]): Promise<Detection[]> {
    const detections: Detection[] = [];
    const thresholdMs = this.config.stalePRThresholdHours * 60 * 60 * 1000;

    for (const pr of prs) {
      if (pr.draft) continue;
      if (this.hasExcludedLabel(pr)) continue;

      const lastActivity = new Date(pr.updated_at).getTime();
      const age = Date.now() - lastActivity;

      if (age > thresholdMs) {
        detections.push({
          type: "stuck_pr",
          target: {
            owner: this.config.owner,
            repo: this.config.repo,
            number: pr.number,
            kind: "pr",
          },
          reason: `No activity for ${Math.round(age / 3600000)}h`,
          metadata: { lastUpdated: pr.updated_at, title: pr.title },
        });
      }
    }

    return detections;
  }

  /**
   * Detect PRs with a CI check pending for > 90 minutes (zombie CI runs).
   */
  private async detectZombieCI(prs: GitHubPR[]): Promise<Detection[]> {
    const detections: Detection[] = [];
    const zombieThresholdMs = 90 * 60 * 1000;

    for (const pr of prs) {
      if (pr.draft) continue;
      if (this.hasExcludedLabel(pr)) continue;

      try {
        const checkRuns = await this.githubFetch<{ check_runs: GitHubCheckRun[] }>(
          `/repos/${this.config.owner}/${this.config.repo}/commits/${pr.head.sha}/check-runs`,
        );

        for (const run of checkRuns.check_runs) {
          if (run.status === "completed") continue;
          const age = Date.now() - new Date(run.started_at).getTime();
          if (age > zombieThresholdMs) {
            detections.push({
              type: "zombie_ci",
              target: {
                owner: this.config.owner,
                repo: this.config.repo,
                number: pr.number,
                kind: "pr",
              },
              reason: `CI check "${run.name}" pending for ${Math.round(age / 60000)}min`,
              metadata: { checkName: run.name, startedAt: run.started_at },
            });
            break; // one detection per PR
          }
        }
      } catch (err) {
        logger.warn("Error checking zombie CI", { pr: pr.number, error: String(err) });
      }
    }

    return detections;
  }

  /**
   * Detect PRs where Builder is thrashing: 3+ commits pushed after the last Architect review.
   */
  private async detectBuilderThrashing(prs: GitHubPR[]): Promise<Detection[]> {
    const detections: Detection[] = [];

    for (const pr of prs) {
      if (pr.draft) continue;
      if (this.hasExcludedLabel(pr)) continue;

      try {
        const comments = await this.githubFetch<GitHubComment[]>(
          `/repos/${this.config.owner}/${this.config.repo}/issues/${pr.number}/comments`,
        );

        const reviewComments = comments
          .filter((c) => c.body.includes("## Architect Review"))
          .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

        if (reviewComments.length === 0) continue;

        const latestReviewTime = new Date(reviewComments[0].created_at).getTime();

        const commits = await this.githubFetch<GitHubCommit[]>(
          `/repos/${this.config.owner}/${this.config.repo}/pulls/${pr.number}/commits`,
        );

        const commitsAfterReview = commits.filter(
          (c) => new Date(c.commit.committer.date).getTime() > latestReviewTime,
        );

        if (commitsAfterReview.length >= 3) {
          detections.push({
            type: "builder_thrashing",
            target: {
              owner: this.config.owner,
              repo: this.config.repo,
              number: pr.number,
              kind: "pr",
            },
            reason: `${commitsAfterReview.length} commits pushed after last Architect review — Builder may be stuck in fix loop`,
            metadata: {
              commitsAfterReview: commitsAfterReview.length,
              lastReviewAt: reviewComments[0].created_at,
            },
          });
        }
      } catch (err) {
        logger.warn("Error checking builder thrashing", { pr: pr.number, error: String(err) });
      }
    }

    return detections;
  }

  // --- Event Emission ---

  /**
   * Emit a synthetic event to the EventBus based on detection type.
   * ReactionsManager handles all actual mutations.
   */
  private async emitDetection(detection: Detection, cycleId: string): Promise<void> {
    const eventMap: Record<DetectionType, string> = {
      orphaned_issue: "reconciler:orphaned_issue",
      stale_approval: "reconciler:stale_approval",
      branch_behind: "reconciler:branch_behind",
      ready_to_merge: "reconciler:ready_to_merge",
      stuck_pr: "reconciler:stuck_pr",
      builder_thrashing: "reconciler:builder_thrashing",
      zombie_ci: "reconciler:zombie_ci",
    };

    const eventType = eventMap[detection.type];
    const correlationId = `recon-${detection.target.number}-${Date.now()}`;

    await this.deps.emitEvent(
      "reconciler",
      eventType,
      {
        ...detection.metadata,
        pr_number: detection.target.kind === "pr" ? detection.target.number : undefined,
        issue_number: detection.target.kind === "issue" ? detection.target.number : undefined,
        owner: detection.target.owner,
        repo: detection.target.repo,
        reason: detection.reason,
        cycleId,
      },
      correlationId,
    );

    logger.info("Detection emitted", {
      type: detection.type,
      number: detection.target.number,
      reason: detection.reason,
    });
  }

  // --- GitHub API Helpers ---

  private async fetchOpenPRs(): Promise<GitHubPR[]> {
    const allPRs: GitHubPR[] = [];
    let page = 1;
    const perPage = 100;

    while (true) {
      const prs = await this.githubFetch<GitHubPR[]>(
        `/repos/${this.config.owner}/${this.config.repo}/pulls?state=open&per_page=${perPage}&page=${page}`,
      );
      allPRs.push(...prs);
      if (prs.length < perPage) break;
      page++;
    }

    return allPRs;
  }

  private async fetchOpenIssues(): Promise<GitHubIssue[]> {
    const allIssues: GitHubIssue[] = [];
    let page = 1;
    const perPage = 100;

    while (true) {
      const issues = await this.githubFetch<GitHubIssue[]>(
        `/repos/${this.config.owner}/${this.config.repo}/issues?state=open&per_page=${perPage}&page=${page}`,
      );
      allIssues.push(...issues);
      if (issues.length < perPage) break;
      page++;
    }

    return allIssues;
  }

  private hasExcludedLabel(item: { labels: Array<{ name: string }> }): boolean {
    return item.labels.some((l) => EXCLUDED_LABELS.includes(l.name));
  }

  private async githubFetch<T>(path: string): Promise<T> {
    const url = path.startsWith("http") ? path : `https://api.github.com${path}`;
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${this.deps.githubToken}`,
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "yclaw-reconciler",
      },
    });

    if (!response.ok) {
      throw new Error(`GitHub API ${response.status}: ${response.statusText} for ${path}`);
    }

    return response.json() as Promise<T>;
  }
}
