/**
 * Default reaction rules — hardcoded lifecycle automation rules.
 *
 * These rules close the loop on the GitHub issue → PR → CI → review → merge
 * lifecycle. They fire automatically based on GitHub webhook events.
 */

import type { ReactionRule } from './types.js';
import { getChannelForDepartment } from '../utils/channel-routing.js';

/**
 * GitHub login(s) authorized for comment-based PR approval.
 * Set via ARCHITECT_GITHUB_LOGINS env var at runtime.
 * This constant is the compile-time fallback used in rule definitions.
 */
const ARCHITECT_REVIEWER =
  process.env.ARCHITECT_GITHUB_LOGINS ?? 'CONFIGURE_ARCHITECT_GITHUB_LOGINS';

export const DEFAULT_REACTION_RULES: ReactionRule[] = [
  // ─── 1. CI Failed on PR Branch → Trigger Builder to Fix ──────────────
  {
    id: 'ci-failed-on-pr',
    enabled: true,
    trigger: {
      event: 'github:ci_fail',
      // Only PR branches, not default branch (default branch CI is Deployer's domain)
    },
    actions: [
      {
        type: 'task:update',
        params: { stage: 'ci_failed', status: 'in_progress' },
      },
      {
        type: 'agent:trigger',
        params: {
          agent: 'builder',
          task: 'CI failed on PR branch {{branch}} (workflow: {{workflow}}, commit: {{commit_sha}}). Investigate the failure at {{url}} and push a fix.',
        },
      },
    ],
    retry: { max: 2, delayMs: 60_000 },
    escalation: {
      afterMs: 30 * 60 * 1000, // 30 minutes
      action: {
        type: 'discord:message',
        params: {
          channel: getChannelForDepartment('alerts', 'discord') ?? '',
          text: '🚨 CI stuck on branch {{branch}} after 2 retries. Workflow: {{workflow}}. Needs human attention: {{url}}',
        },
      },
    },
  },

  // ─── 2. Changes Requested on PR → Trigger Builder ────────────────────
  {
    id: 'changes-requested',
    enabled: true,
    trigger: {
      event: 'github:pr_review_submitted',
      filter: { review_state: 'changes_requested' },
    },
    actions: [
      {
        type: 'task:update',
        params: { stage: 'changes_requested', status: 'in_progress' },
      },
      {
        type: 'agent:trigger',
        params: {
          agent: 'builder',
          task: 'Review feedback on PR #{{pr_number}}: {{review_body}}. Address the requested changes and push updates. PR: {{pr_url}}',
        },
      },
    ],
    escalation: {
      afterMs: 30 * 60 * 1000,
      action: {
        type: 'discord:message',
        params: {
          channel: getChannelForDepartment('alerts', 'discord') ?? '',
          text: '🚨 Review comments unaddressed on PR #{{pr_number}} for 30+ minutes. Reviewer: {{reviewer}}. {{pr_url}}',
        },
      },
    },
  },

  // ─── 2b. Auto-Update Branch When Behind Master ─────────────────────────
  //
  // When CI passes on a PR but the branch is behind master (strict checks
  // require up-to-date branches), auto-update the branch. The CI re-run
  // after update will re-trigger auto-merge-on-ci-pass.
  //
  {
    id: 'auto-update-behind-branch',
    enabled: true,
    trigger: {
      event: 'github:ci_pass',
    },
    conditions: [
      { type: 'ci_green' },
    ],
    safetyGates: [
      { type: 'comment_approved', params: { reviewers: [ARCHITECT_REVIEWER] } },
      { type: 'no_merge_conflicts' },
      { type: 'no_label', params: { label: 'do-not-merge' } },
    ],
    // Note: NO branch_up_to_date gate — we WANT this to fire when behind
    actions: [
      {
        type: 'github:update_branch',
        params: {},
      },
      {
        type: 'discord:message',
        params: {
          channel: getChannelForDepartment('development', 'discord') ?? '',
          text: '🔄 Auto-updating PR #{{pr_number}} branch — was behind master. CI will re-run.',
        },
      },
    ],
  },

  // ─── 3. Auto-Merge: CI Pass → Check if PR has Architect approval + green ──
  //
  // PROCESS FIX (2026-02-25): Replaced min_approvals + required_reviewer gates
  // with comment_approved. GitHub blocks same-account formal approvals (ARCHITECT_GITHUB_LOGINS),
  // so Architect posts a PR comment "## Architect Review … **Status: [APPROVED]**"
  // instead. The gate verifies that comment exists and post-dates the head commit.
  //
  {
    id: 'auto-merge-on-ci-pass',
    enabled: true,
    trigger: {
      event: 'github:ci_pass',
      // Fires on default branch CI pass too, but prNumber will be absent → gate fails
    },
    conditions: [
      { type: 'ci_green' },
    ],
    safetyGates: [
      { type: 'all_checks_passed' },
      // ARCHITECT_GITHUB_LOGINS is the current single-account Architect login.
      // Update to ['yclaw-architect'] when the dedicated account is created.
      { type: 'comment_approved', params: { reviewers: [ARCHITECT_REVIEWER] } },
      { type: 'no_merge_conflicts' },
      { type: 'branch_up_to_date' },
      { type: 'no_label', params: { label: 'do-not-merge' } },
      { type: 'dod_gate_passed' },
    ],
    actions: [
      {
        type: 'github:merge_pr',
        params: { merge_method: 'squash' },
      },
      {
        type: 'task:update',
        params: { stage: 'merged', status: 'completed' },
      },
      {
        type: 'discord:message',
        params: {
          channel: getChannelForDepartment('development', 'discord') ?? '',
          text: '✅ Auto-merged PR #{{pr_number}} ({{head_branch}}) — reviewed by {{reviewer}}',
        },
      },
    ],
  },

  // ─── 4. Auto-Merge: Review Approved → Check if CI is green ───────────
  //
  // PROCESS FIX (2026-02-25): Same comment_approved gate as rule 3.
  //
  {
    id: 'auto-merge-on-approval',
    enabled: true,
    trigger: {
      event: 'github:pr_review_submitted',
      filter: { review_state: 'approved' },
    },
    conditions: [
      { type: 'ci_green' },
    ],
    safetyGates: [
      { type: 'all_checks_passed' },
      { type: 'comment_approved', params: { reviewers: [ARCHITECT_REVIEWER] } },
      { type: 'no_merge_conflicts' },
      { type: 'branch_up_to_date' },
      { type: 'no_label', params: { label: 'do-not-merge' } },
      { type: 'dod_gate_passed' },
    ],
    actions: [
      {
        type: 'github:merge_pr',
        params: { merge_method: 'squash' },
      },
      {
        type: 'task:update',
        params: { stage: 'merged', status: 'completed' },
      },
      {
        type: 'discord:message',
        params: {
          channel: getChannelForDepartment('development', 'discord') ?? '',
          text: '✅ Auto-merged PR #{{pr_number}} after approval by {{reviewer}}',
        },
      },
    ],
  },

  // ─── 5. PR Merged → Close Linked Issues ──────────────────────────────
  {
    id: 'pr-merged-close-issues',
    enabled: true,
    trigger: {
      event: 'github:pr_merged',
    },
    conditions: [
      { type: 'has_linked_issue' },
    ],
    actions: [
      {
        type: 'github:close_issue',
        params: { comment: 'Closed by PR #{{pr_number}}' },
      },
      {
        type: 'task:update',
        params: { stage: 'completed', status: 'completed' },
      },
      {
        type: 'event:publish',
        params: { type: 'task:completed', data: { pr: '{{pr_number}}' } },
      },
    ],
  },

  // ─── 5b. Auto-Merge: Architect Comment Approved → Check if CI is green ──
  //
  // Handles the case where Architect posts an [APPROVED] comment AFTER CI has
  // already passed. Rule 3 (ci_pass) and Rule 4 (review_submitted) can't catch
  // this because:
  //   - Rule 3 fires when CI passes — but at that point no comment exists yet
  //   - Rule 4 fires on formal review objects — Architect uses comments instead
  //     (same-account pipeline: formal reviews blocked by GitHub)
  // This rule closes the gap: when the comment arrives and CI is already green,
  // trigger merge immediately.
  //
  {
    id: 'auto-merge-on-architect-comment',
    enabled: true,
    trigger: {
      event: 'github:pr_review_comment',
      filter: { review_state: 'approved' },
    },
    conditions: [
      { type: 'ci_green' },
    ],
    safetyGates: [
      { type: 'all_checks_passed' },
      { type: 'comment_approved', params: { reviewers: [ARCHITECT_REVIEWER] } },
      { type: 'no_merge_conflicts' },
      { type: 'branch_up_to_date' },
      { type: 'no_label', params: { label: 'do-not-merge' } },
      { type: 'dod_gate_passed' },
    ],
    actions: [
      {
        type: 'github:merge_pr',
        params: { merge_method: 'squash' },
      },
      {
        type: 'task:update',
        params: { stage: 'merged', status: 'completed' },
      },
      {
        type: 'discord:message',
        params: {
          channel: getChannelForDepartment('development', 'discord') ?? '',
          text: '✅ Auto-merged PR #{{pr_number}} — Architect comment [APPROVED], CI was green',
        },
      },
    ],
  },

  // ─── 6. New Issue → Auto-assign to Builder (unless human-only) ─────────
  //
  // FIX (2026-03-03): Changed from opt-in (require 'agent-work' label) to
  // opt-out (exclude 'human-only' label). Issues without 'human-only' are
  // auto-routed to Builder. Prevents silent drops where issues sit unassigned
  // because nobody remembered to add a label. See issue #239.
  //
  {
    id: 'new-issue-auto-assign',
    enabled: true,
    trigger: {
      event: 'github:issue_opened',
      filter: {},
    },
    conditions: [
      { type: 'label_absent', params: { label: 'human-only' } },
    ],
    actions: [
      {
        type: 'task:create',
        params: {
          task: 'implement_issue',
          priority: 'P1',
          issueNumber: '{{issue_number}}',
          correlationId: '{{correlationId}}',
        },
      },
      {
        type: 'agent:trigger',
        params: {
          agent: 'builder',
          task: 'Work on issue #{{issue_number}}: {{issue_title}}. {{issue_body}}',
          workflow: 'implement_issue',
          workflow_params: {
            issue_number: '{{issue_number}}',
            repo_full: '{{repo_full}}',
            issue_url: '{{url}}',
          },
        },
      },
    ],
  },

  // ─── 6b. Issue Closed → Clean up TaskRegistry ──────────────────────────
  //
  // When an issue is closed (directly or via PR merge), mark associated tasks
  // as completed. Without this, tasks for closed issues remain pending forever
  // in the TaskRegistry — Strategist reports them as stale on every heartbeat.
  //
  {
    id: 'issue-closed-task-cleanup',
    enabled: true,
    trigger: {
      event: 'github:issue_closed',
    },
    conditions: [],
    actions: [
      {
        type: 'task:update',
        params: { stage: 'completed', status: 'completed' },
      },
    ],
  },

  // ─── 8. Stale Review Detection — Re-request review when commits pushed after approval ──
  {
    id: 'stale-review-re-request',
    enabled: true,
    trigger: {
      event: 'github:push',
      filter: {},
    },
    conditions: [],
    actions: [
      {
        type: 'agent:trigger',
        params: {
          agent: 'architect',
          task: 'Re-review PR #{{pr_number}} — new commits were pushed after your last approval. Review the delta and post a fresh Architect Review comment. PR: {{pr_url}}',
        },
      },
      {
        type: 'discord:message',
        params: {
          channel: getChannelForDepartment('development', 'discord') ?? '',
          text: '🔄 Stale review detected on PR #{{pr_number}} — requesting Architect re-review after new commits.',
        },
      },
    ],
  },

  // ─── 7. Issue Labeled → Catch issues that missed auto-assign on creation ──
  //
  // FIX (2026-03-03): When a label is added to an existing issue, re-evaluate
  // for Builder assignment. This handles the case where issues are created
  // without the right labels and labeled later. Without this, adding labels
  // after creation was a no-op — Builder never saw the issue. See issue #239.
  //
  {
    id: 'issue-labeled-auto-assign',
    enabled: true,
    trigger: {
      event: 'github:issue_labeled',
      filter: {},
    },
    conditions: [
      { type: 'label_absent', params: { label: 'human-only' } },
    ],
    actions: [
      {
        type: 'agent:trigger',
        params: {
          agent: 'builder',
          task: 'Work on issue #{{issue_number}}: {{issue_title}}. {{issue_body}}',
          workflow: 'implement_issue',
          workflow_params: {
            issue_number: '{{issue_number}}',
            repo_full: '{{repo_full}}',
            issue_url: '{{url}}',
          },
        },
      },
    ],
  },
];
