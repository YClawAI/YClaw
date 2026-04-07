/**
 * Tests for PRReconciler — Phase 1 PR/Issue reconciliation loop.
 *
 * Covers:
 *   1. Cycle lock — second attempt returns early
 *   2. Stale approval detection
 *   3. Ready-to-merge detection
 *   4. Orphaned issue detection
 *   5. Branch behind detection
 *   6. Stuck PR detection
 *   7. Budget limit — only maxActionsPerCycle emitted
 *   8. Resource lock — detection skipped when locked
 *   9. Draft PR exclusion
 *  10. Label exclusion (human-only, stalled, do-not-merge)
 *  11. Circuit breaker — orphaned issues skipped when open
 *  12. Zombie CI detection
 *  13. Builder thrashing detection
 *  14. Grace period — issues created < 30min ago are NOT orphaned
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mock Redis ──────────────────────────────────────────────────────────────

function createMockRedis() {
  const store = new Map<string, string>();

  return {
    set: vi.fn(async (key: string, value: string, ...args: unknown[]) => {
      if (args.includes("NX") && store.has(key)) return null;
      store.set(key, value);
      return "OK";
    }),
    del: vi.fn(async (key: string) => {
      store.delete(key);
      return 1;
    }),
    exists: vi.fn(async (key: string) => (store.has(key) ? 1 : 0)),
    _store: store,
  };
}

// ─── Mock Logger ─────────────────────────────────────────────────────────────

vi.mock("../src/logging/logger.js", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// ─── Import after mocks ──────────────────────────────────────────────────────

const { PRReconciler } = await import("../src/services/reconciler.js");

// ─── Fixtures ────────────────────────────────────────────────────────────────

function ts(offsetMs = 0): string {
  return new Date(Date.now() + offsetMs).toISOString();
}

function makePR(overrides: Partial<{
  number: number;
  draft: boolean;
  mergeable_state: string | null;
  updated_at: string;
  labels: Array<{ name: string }>;
  head: { sha: string; ref: string };
}> = {}) {
  return {
    number: 42,
    title: "feat: test PR",
    state: "open",
    draft: false,
    mergeable: true,
    mergeable_state: "clean",
    updated_at: ts(-1000),
    created_at: ts(-2000),
    labels: [] as Array<{ name: string }>,
    head: { sha: "abc123def456", ref: "feat/test" },
    base: { ref: "master" },
    assignees: [],
    ...overrides,
  };
}

function makeIssue(overrides: Partial<{
  number: number;
  created_at: string;
  labels: Array<{ name: string }>;
  assignees: Array<{ login: string }>;
  pull_request: unknown;
}> = {}) {
  return {
    number: 99,
    title: "bug: something broken",
    state: "open",
    created_at: ts(-2 * 60 * 60 * 1000), // 2 hours old by default
    updated_at: ts(-1000),
    labels: [] as Array<{ name: string }>,
    assignees: [] as Array<{ login: string }>,
    ...overrides,
  };
}

function makeComment(body: string, createdAt: string, login = "architect") {
  return { body, created_at: createdAt, user: { login } };
}

function makeCommit(sha: string, date: string) {
  return { sha, commit: { committer: { date }, author: { date } } };
}

function makeCheckRun(name: string, status: string, conclusion: string | null, startedAt: string) {
  return { name, status, conclusion, started_at: startedAt };
}

// ─── Test Helpers ─────────────────────────────────────────────────────────────

function createDeps(redis: ReturnType<typeof createMockRedis>, fetchImpl: (path: string) => unknown) {
  const emitEvent = vi.fn(async () => {});
  const notifySlack = vi.fn(async () => {});

  const reconciler = new PRReconciler(
    {
      redis: redis as never,
      githubToken: "test-token",
      emitEvent,
      notifySlack,
    },
    {
      owner: "TestOrg",
      repo: "test-repo",
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
    },
  );

  // Spy on the private githubFetch method
  vi.spyOn(reconciler as never, "githubFetch").mockImplementation(
    async (path: string) => fetchImpl(path) as never,
  );

  return { reconciler, emitEvent, notifySlack };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("PRReconciler", () => {
  let redis: ReturnType<typeof createMockRedis>;

  beforeEach(() => {
    redis = createMockRedis();
    vi.clearAllMocks();
  });

  // ── 1. Cycle Lock ──────────────────────────────────────────────────────────

  describe("cycle lock", () => {
    it("runs normally when no lock is held", async () => {
      const { reconciler, emitEvent } = createDeps(redis, (path) => {
        if (path.includes("/pulls?")) return [];
        if (path.includes("/issues?")) return [];
        return [];
      });

      const result = await reconciler.runCycle();
      expect(result.cycleId).toMatch(/^recon-/);
      expect(result.completedAt).toBeTruthy();
    });

    it("returns early when another cycle holds the lock", async () => {
      // Pre-populate the lock
      redis._store.set("reconciler:cycle:lock", "recon-other-instance");

      const { reconciler, emitEvent } = createDeps(redis, (_path) => []);
      const result = await reconciler.runCycle();

      expect(result.detections).toHaveLength(0);
      expect(result.emitted).toHaveLength(0);
      // githubFetch should not be called
      expect(emitEvent).not.toHaveBeenCalled();
    });

    it("releases lock in finally block even on error", async () => {
      const { reconciler } = createDeps(redis, (_path) => {
        throw new Error("Network failure");
      });

      await expect(reconciler.runCycle()).rejects.toThrow("Network failure");

      // Lock should be released
      expect(redis._store.has("reconciler:cycle:lock")).toBe(false);
    });
  });

  // ── 2. Stale Approval Detection ───────────────────────────────────────────

  describe("detectStaleApprovals", () => {
    it("detects PR where head commit is newer than approval", async () => {
      const approvalTime = ts(-60 * 60 * 1000); // 1h ago
      const commitTime = ts(-30 * 60 * 1000);   // 30min ago (newer)

      const pr = makePR({ number: 10 });

      const { reconciler, emitEvent } = createDeps(redis, (path) => {
        if (path.includes("/pulls?")) return [pr];
        if (path.includes("/issues?")) return [];
        if (path.includes(`/issues/${pr.number}/comments`)) {
          return [makeComment("## Architect Review\n[APPROVED]", approvalTime)];
        }
        if (path.includes(`/pulls/${pr.number}/commits`)) {
          return [makeCommit("newsha123", commitTime)];
        }
        return [];
      });

      const result = await reconciler.runCycle();

      const stale = result.detections.filter((d) => d.type === "stale_approval");
      expect(stale).toHaveLength(1);
      expect(stale[0]?.target.number).toBe(10);
    });

    it("does NOT detect when approval is newer than head commit", async () => {
      const commitTime = ts(-60 * 60 * 1000); // 1h ago
      const approvalTime = ts(-30 * 60 * 1000); // 30min ago (newer)

      const pr = makePR({ number: 11 });

      const { reconciler } = createDeps(redis, (path) => {
        if (path.includes("/pulls?")) return [pr];
        if (path.includes("/issues?")) return [];
        if (path.includes(`/issues/${pr.number}/comments`)) {
          return [makeComment("## Architect Review\n[APPROVED]", approvalTime)];
        }
        if (path.includes(`/pulls/${pr.number}/commits`)) {
          return [makeCommit("oldsha123", commitTime)];
        }
        return [];
      });

      const result = await reconciler.runCycle();
      expect(result.detections.filter((d) => d.type === "stale_approval")).toHaveLength(0);
    });

    it("skips draft PRs", async () => {
      const pr = makePR({ number: 12, draft: true });

      const { reconciler } = createDeps(redis, (path) => {
        if (path.includes("/pulls?")) return [pr];
        if (path.includes("/issues?")) return [];
        return [];
      });

      const result = await reconciler.runCycle();
      expect(result.detections.filter((d) => d.type === "stale_approval")).toHaveLength(0);
    });
  });

  // ── 3. Ready to Merge Detection ───────────────────────────────────────────

  describe("detectReadyToMerge", () => {
    it("detects PR with CI green + fresh approval + clean state", async () => {
      const commitTime = ts(-2 * 60 * 60 * 1000); // 2h ago
      const approvalTime = ts(-30 * 60 * 1000);   // 30min ago (newer than commit)

      const pr = makePR({ number: 20, mergeable_state: "clean", head: { sha: "cleansha", ref: "feat/x" } });

      const { reconciler } = createDeps(redis, (path) => {
        if (path.includes("/pulls?")) return [pr];
        if (path.includes("/issues?")) return [];
        if (path.includes(`/issues/${pr.number}/comments`)) {
          return [makeComment("## Architect Review\n[APPROVED]", approvalTime)];
        }
        if (path.includes(`/pulls/${pr.number}/commits`)) {
          return [makeCommit("cleansha", commitTime)];
        }
        if (path.includes("/commits/cleansha/check-runs")) {
          return {
            check_runs: [
              makeCheckRun("CI", "completed", "success", ts(-60 * 60 * 1000)),
            ],
          };
        }
        return [];
      });

      const result = await reconciler.runCycle();
      const ready = result.detections.filter((d) => d.type === "ready_to_merge");
      expect(ready).toHaveLength(1);
      expect(ready[0]?.target.number).toBe(20);
    });

    it("does NOT detect when mergeable_state is not clean", async () => {
      const pr = makePR({ number: 21, mergeable_state: "behind" });

      const { reconciler } = createDeps(redis, (path) => {
        if (path.includes("/pulls?")) return [pr];
        if (path.includes("/issues?")) return [];
        return [];
      });

      const result = await reconciler.runCycle();
      expect(result.detections.filter((d) => d.type === "ready_to_merge")).toHaveLength(0);
    });

    it("does NOT detect when approval predates the head commit", async () => {
      const approvalTime = ts(-2 * 60 * 60 * 1000); // 2h ago
      const commitTime = ts(-30 * 60 * 1000);        // 30min ago (newer — stale approval)

      const pr = makePR({ number: 22, mergeable_state: "clean", head: { sha: "newsha22", ref: "feat/y" } });

      const { reconciler } = createDeps(redis, (path) => {
        if (path.includes("/pulls?")) return [pr];
        if (path.includes("/issues?")) return [];
        if (path.includes(`/issues/${pr.number}/comments`)) {
          return [makeComment("## Architect Review\n[APPROVED]", approvalTime)];
        }
        if (path.includes(`/pulls/${pr.number}/commits`)) {
          return [makeCommit("newsha22", commitTime)];
        }
        return [];
      });

      const result = await reconciler.runCycle();
      expect(result.detections.filter((d) => d.type === "ready_to_merge")).toHaveLength(0);
    });
  });

  // ── 4. Orphaned Issue Detection ───────────────────────────────────────────

  describe("detectOrphanedIssues", () => {
    it("detects issue with no assignee past grace period", async () => {
      const issue = makeIssue({ number: 55, created_at: ts(-2 * 60 * 60 * 1000) });

      const { reconciler } = createDeps(redis, (path) => {
        if (path.includes("/pulls?")) return [];
        if (path.includes("/issues?")) return [issue];
        return [];
      });

      const result = await reconciler.runCycle();
      const orphans = result.detections.filter((d) => d.type === "orphaned_issue");
      expect(orphans).toHaveLength(1);
      expect(orphans[0]?.target.number).toBe(55);
    });

    it("does NOT detect issue with an assignee", async () => {
      const issue = makeIssue({
        number: 56,
        created_at: ts(-2 * 60 * 60 * 1000),
        assignees: [{ login: "builder-bot" }],
      });

      const { reconciler } = createDeps(redis, (path) => {
        if (path.includes("/pulls?")) return [];
        if (path.includes("/issues?")) return [issue];
        return [];
      });

      const result = await reconciler.runCycle();
      expect(result.detections.filter((d) => d.type === "orphaned_issue")).toHaveLength(0);
    });

    it("does NOT detect pull_request entries from the issues endpoint", async () => {
      const issue = makeIssue({ number: 57, pull_request: { url: "https://..." } });

      const { reconciler } = createDeps(redis, (path) => {
        if (path.includes("/pulls?")) return [];
        if (path.includes("/issues?")) return [issue];
        return [];
      });

      const result = await reconciler.runCycle();
      expect(result.detections.filter((d) => d.type === "orphaned_issue")).toHaveLength(0);
    });
  });

  // ── 5. Branch Behind Detection ────────────────────────────────────────────

  describe("detectBranchBehind", () => {
    it("detects PR with mergeable_state behind", async () => {
      const pr = makePR({ number: 30, mergeable_state: "behind" });

      const { reconciler } = createDeps(redis, (path) => {
        if (path.includes("/pulls?")) return [pr];
        if (path.includes("/issues?")) return [];
        return [];
      });

      const result = await reconciler.runCycle();
      const behind = result.detections.filter((d) => d.type === "branch_behind");
      expect(behind).toHaveLength(1);
      expect(behind[0]?.target.number).toBe(30);
    });

    it("does NOT flag PR that is clean", async () => {
      const pr = makePR({ number: 31, mergeable_state: "clean" });

      const { reconciler } = createDeps(redis, (path) => {
        if (path.includes("/pulls?")) return [pr];
        if (path.includes("/issues?")) return [];
        // No approval comments → ready_to_merge check also won't fire
        if (path.includes("/comments")) return [];
        if (path.includes("/commits")) return [];
        return [];
      });

      const result = await reconciler.runCycle();
      expect(result.detections.filter((d) => d.type === "branch_behind")).toHaveLength(0);
    });
  });

  // ── 6. Stuck PR Detection ─────────────────────────────────────────────────

  describe("detectStuckPRs", () => {
    it("detects PR with no activity for 48+ hours", async () => {
      const pr = makePR({
        number: 40,
        updated_at: ts(-49 * 60 * 60 * 1000), // 49h ago
        mergeable_state: null,
      });

      const { reconciler } = createDeps(redis, (path) => {
        if (path.includes("/pulls?")) return [pr];
        if (path.includes("/issues?")) return [];
        return [];
      });

      const result = await reconciler.runCycle();
      const stuck = result.detections.filter((d) => d.type === "stuck_pr");
      expect(stuck).toHaveLength(1);
      expect(stuck[0]?.target.number).toBe(40);
    });

    it("does NOT flag recently updated PRs", async () => {
      const pr = makePR({ number: 41, updated_at: ts(-1 * 60 * 60 * 1000), mergeable_state: null });

      const { reconciler } = createDeps(redis, (path) => {
        if (path.includes("/pulls?")) return [pr];
        if (path.includes("/issues?")) return [];
        return [];
      });

      const result = await reconciler.runCycle();
      expect(result.detections.filter((d) => d.type === "stuck_pr")).toHaveLength(0);
    });
  });

  // ── 7. Budget Limit ───────────────────────────────────────────────────────

  describe("budget limit", () => {
    it("only emits maxActionsPerCycle detections, rest are skipped", async () => {
      // Create 7 stuck PRs with budget of 5
      const prs = Array.from({ length: 7 }, (_, i) =>
        makePR({
          number: 100 + i,
          updated_at: ts(-49 * 60 * 60 * 1000),
          mergeable_state: null,
        }),
      );

      const { reconciler, emitEvent } = createDeps(redis, (path) => {
        if (path.includes("/pulls?")) return prs;
        if (path.includes("/issues?")) return [];
        return [];
      });

      const result = await reconciler.runCycle();

      expect(result.emitted.length).toBeLessThanOrEqual(5);
      expect(result.skipped.length).toBeGreaterThanOrEqual(2);
      expect(result.emitted.length + result.skipped.length).toBe(result.detections.length);
      expect(emitEvent).toHaveBeenCalledTimes(result.emitted.length);
    });
  });

  // ── 8. Resource Lock ──────────────────────────────────────────────────────

  describe("resource lock", () => {
    it("skips detection when resource is already locked", async () => {
      const pr = makePR({ number: 50, updated_at: ts(-49 * 60 * 60 * 1000), mergeable_state: null });

      // Pre-lock the resource
      redis._store.set("yclaw:action:TestOrg:test-repo:50", "other-cycle");

      const { reconciler, emitEvent } = createDeps(redis, (path) => {
        if (path.includes("/pulls?")) return [pr];
        if (path.includes("/issues?")) return [];
        return [];
      });

      const result = await reconciler.runCycle();

      expect(result.skipped).toHaveLength(1);
      expect(result.emitted).toHaveLength(0);
      expect(emitEvent).not.toHaveBeenCalled();
    });
  });

  // ── 9. Draft PR Exclusion ─────────────────────────────────────────────────

  describe("draft PR exclusion", () => {
    it("skips draft PRs in all detection checks", async () => {
      const draftPR = makePR({
        number: 60,
        draft: true,
        updated_at: ts(-49 * 60 * 60 * 1000),
        mergeable_state: "behind",
      });

      const { reconciler } = createDeps(redis, (path) => {
        if (path.includes("/pulls?")) return [draftPR];
        if (path.includes("/issues?")) return [];
        return [];
      });

      const result = await reconciler.runCycle();
      expect(result.detections).toHaveLength(0);
    });
  });

  // ── 10. Label Exclusion ───────────────────────────────────────────────────

  describe("label exclusion", () => {
    it.each(["human-only", "stalled", "do-not-merge", "archived"])(
      'skips PRs with label "%s"',
      async (label) => {
        const pr = makePR({
          number: 70,
          labels: [{ name: label }],
          updated_at: ts(-49 * 60 * 60 * 1000),
          mergeable_state: "behind",
        });

        const { reconciler } = createDeps(redis, (path) => {
          if (path.includes("/pulls?")) return [pr];
          if (path.includes("/issues?")) return [];
          return [];
        });

        const result = await reconciler.runCycle();
        expect(result.detections).toHaveLength(0);
      },
    );

    it.each(["human-only", "stalled"])(
      'skips issues with label "%s"',
      async (label) => {
        const issue = makeIssue({
          number: 71,
          labels: [{ name: label }],
          created_at: ts(-2 * 60 * 60 * 1000),
        });

        const { reconciler } = createDeps(redis, (path) => {
          if (path.includes("/pulls?")) return [];
          if (path.includes("/issues?")) return [issue];
          return [];
        });

        const result = await reconciler.runCycle();
        expect(result.detections.filter((d) => d.type === "orphaned_issue")).toHaveLength(0);
      },
    );
  });

  // ── 11. Circuit Breaker ───────────────────────────────────────────────────

  describe("circuit breaker", () => {
    it("skips orphaned issues when circuit breaker is open", async () => {
      const issue = makeIssue({ number: 80, created_at: ts(-2 * 60 * 60 * 1000) });

      const redis2 = createMockRedis();
      const emitEvent = vi.fn(async () => {});
      const isCircuitBreakerOpen = vi.fn(() => true);

      const reconciler = new PRReconciler(
        {
          redis: redis2 as never,
          githubToken: "test-token",
          emitEvent,
          isCircuitBreakerOpen,
        },
        { owner: "TestOrg", repo: "test-repo" },
      );

      vi.spyOn(reconciler as never, "githubFetch").mockImplementation(async (path: string) => {
        if ((path as string).includes("/pulls?")) return [] as never;
        if ((path as string).includes("/issues?")) return [issue] as never;
        return [] as never;
      });

      const result = await reconciler.runCycle();
      expect(result.detections.filter((d) => d.type === "orphaned_issue")).toHaveLength(0);
      expect(isCircuitBreakerOpen).toHaveBeenCalledWith("TestOrg/test-repo");
    });
  });

  // ── 12. Zombie CI Detection ───────────────────────────────────────────────

  describe("detectZombieCI", () => {
    it("detects check run pending for > 90 minutes", async () => {
      const pr = makePR({ number: 90, head: { sha: "zombiesha", ref: "feat/z" }, mergeable_state: null });
      const startedAt = ts(-95 * 60 * 1000); // 95 min ago

      const { reconciler } = createDeps(redis, (path) => {
        if (path.includes("/pulls?")) return [pr];
        if (path.includes("/issues?")) return [];
        if (path.includes("/commits/zombiesha/check-runs")) {
          return {
            check_runs: [makeCheckRun("CI / build", "in_progress", null, startedAt)],
          };
        }
        return { check_runs: [] };
      });

      const result = await reconciler.runCycle();
      const zombies = result.detections.filter((d) => d.type === "zombie_ci");
      expect(zombies).toHaveLength(1);
      expect(zombies[0]?.target.number).toBe(90);
      expect(zombies[0]?.reason).toContain("CI / build");
    });

    it("does NOT flag check runs pending for < 90 minutes", async () => {
      const pr = makePR({ number: 91, head: { sha: "freshsha", ref: "feat/w" }, mergeable_state: null });
      const startedAt = ts(-30 * 60 * 1000); // only 30 min ago

      const { reconciler } = createDeps(redis, (path) => {
        if (path.includes("/pulls?")) return [pr];
        if (path.includes("/issues?")) return [];
        if (path.includes("/commits/freshsha/check-runs")) {
          return {
            check_runs: [makeCheckRun("CI / build", "in_progress", null, startedAt)],
          };
        }
        return { check_runs: [] };
      });

      const result = await reconciler.runCycle();
      expect(result.detections.filter((d) => d.type === "zombie_ci")).toHaveLength(0);
    });
  });

  // ── 13. Builder Thrashing Detection ──────────────────────────────────────

  describe("detectBuilderThrashing", () => {
    it("detects 3+ commits after last Architect review", async () => {
      const reviewTime = ts(-3 * 60 * 60 * 1000); // 3h ago

      const pr = makePR({ number: 95, mergeable_state: null });

      const { reconciler } = createDeps(redis, (path) => {
        if (path.includes("/pulls?")) return [pr];
        if (path.includes("/issues?")) return [];
        if (path.includes(`/issues/${pr.number}/comments`)) {
          return [makeComment("## Architect Review\n[CHANGES_REQUESTED]", reviewTime)];
        }
        if (path.includes(`/pulls/${pr.number}/commits`)) {
          // 4 commits after the review
          return [
            makeCommit("sha1", ts(-2.5 * 60 * 60 * 1000)),
            makeCommit("sha2", ts(-2 * 60 * 60 * 1000)),
            makeCommit("sha3", ts(-1.5 * 60 * 60 * 1000)),
            makeCommit("sha4", ts(-1 * 60 * 60 * 1000)),
          ];
        }
        return [];
      });

      const result = await reconciler.runCycle();
      const thrashing = result.detections.filter((d) => d.type === "builder_thrashing");
      expect(thrashing).toHaveLength(1);
      expect(thrashing[0]?.metadata?.["commitsAfterReview"]).toBe(4);
    });

    it("does NOT detect thrashing with only 2 commits after review", async () => {
      const reviewTime = ts(-3 * 60 * 60 * 1000);

      const pr = makePR({ number: 96, mergeable_state: null });

      const { reconciler } = createDeps(redis, (path) => {
        if (path.includes("/pulls?")) return [pr];
        if (path.includes("/issues?")) return [];
        if (path.includes(`/issues/${pr.number}/comments`)) {
          return [makeComment("## Architect Review\n[APPROVED]", reviewTime)];
        }
        if (path.includes(`/pulls/${pr.number}/commits`)) {
          return [
            makeCommit("sha1", ts(-2.5 * 60 * 60 * 1000)),
            makeCommit("sha2", ts(-2 * 60 * 60 * 1000)),
          ];
        }
        return [];
      });

      const result = await reconciler.runCycle();
      expect(result.detections.filter((d) => d.type === "builder_thrashing")).toHaveLength(0);
    });
  });

  // ── 14. Grace Period ──────────────────────────────────────────────────────

  describe("orphan grace period", () => {
    it("does NOT flag issues created less than 30 minutes ago", async () => {
      const issue = makeIssue({
        number: 98,
        created_at: ts(-15 * 60 * 1000), // only 15 min ago
      });

      const { reconciler } = createDeps(redis, (path) => {
        if (path.includes("/pulls?")) return [];
        if (path.includes("/issues?")) return [issue];
        return [];
      });

      const result = await reconciler.runCycle();
      expect(result.detections.filter((d) => d.type === "orphaned_issue")).toHaveLength(0);
    });

    it("DOES flag issues created more than 30 minutes ago", async () => {
      const issue = makeIssue({
        number: 97,
        created_at: ts(-31 * 60 * 1000), // 31 min ago
      });

      const { reconciler } = createDeps(redis, (path) => {
        if (path.includes("/pulls?")) return [];
        if (path.includes("/issues?")) return [issue];
        return [];
      });

      const result = await reconciler.runCycle();
      expect(result.detections.filter((d) => d.type === "orphaned_issue")).toHaveLength(1);
    });
  });

  // ── Result Structure ──────────────────────────────────────────────────────

  describe("result structure", () => {
    it("populates all result fields correctly", async () => {
      const { reconciler } = createDeps(redis, (path) => {
        if (path.includes("/pulls?")) return [];
        if (path.includes("/issues?")) return [];
        return [];
      });

      const result = await reconciler.runCycle();

      expect(result.cycleId).toMatch(/^recon-\d+-[a-z0-9]+$/);
      expect(result.startedAt).toBeTruthy();
      expect(result.completedAt).toBeTruthy();
      expect(Array.isArray(result.detections)).toBe(true);
      expect(Array.isArray(result.emitted)).toBe(true);
      expect(Array.isArray(result.skipped)).toBe(true);
      expect(Array.isArray(result.errors)).toBe(true);
    });

    it("emits Slack summary when detections are emitted", async () => {
      const pr = makePR({
        number: 200,
        updated_at: ts(-49 * 60 * 60 * 1000),
        mergeable_state: null,
      });

      const { reconciler, notifySlack } = createDeps(redis, (path) => {
        if (path.includes("/pulls?")) return [pr];
        if (path.includes("/issues?")) return [];
        return [];
      });

      const result = await reconciler.runCycle();
      expect(result.emitted.length).toBeGreaterThan(0);
      expect(notifySlack).toHaveBeenCalledTimes(1);
    });

    it("does NOT call Slack when nothing is emitted", async () => {
      const { reconciler, notifySlack } = createDeps(redis, (path) => {
        if (path.includes("/pulls?")) return [];
        if (path.includes("/issues?")) return [];
        return [];
      });

      await reconciler.runCycle();
      expect(notifySlack).not.toHaveBeenCalled();
    });
  });

  // ── Dry Run ───────────────────────────────────────────────────────────────

  describe("dry run mode", () => {
    it("emits events but does not acquire resource locks in dryRun mode", async () => {
      const pr = makePR({ number: 300, updated_at: ts(-49 * 60 * 60 * 1000), mergeable_state: null });

      const redis2 = createMockRedis();
      const emitEvent = vi.fn(async () => {});

      const reconciler = new PRReconciler(
        { redis: redis2 as never, githubToken: "test-token", emitEvent },
        { owner: "TestOrg", repo: "test-repo", dryRun: true },
      );

      vi.spyOn(reconciler as never, "githubFetch").mockImplementation(async (path: string) => {
        if ((path as string).includes("/pulls?")) return [pr] as never;
        if ((path as string).includes("/issues?")) return [] as never;
        return [] as never;
      });

      const result = await reconciler.runCycle();

      expect(result.emitted.length).toBeGreaterThan(0);
      // Resource lock should NOT be set in dry run mode
      const resourceKey = "yclaw:action:TestOrg:test-repo:300";
      expect(redis2._store.has(resourceKey)).toBe(false);
    });
  });
});
