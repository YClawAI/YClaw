# Reactions System

Declarative lifecycle automation for GitHub events. Reactions watch for webhook
events on the internal event bus and automatically trigger actions: merge PRs,
close issues, trigger agents, post to Slack, etc.

## Architecture

```
Event Bus → ReactionsManager → ReactionEvaluator → Action Executors
                                    ↓
                              EscalationManager (Redis ZSET + Hash timers)
```

## Modules

| Module | Purpose |
|---|---|
| `types.ts` | Type definitions: `ReactionRule`, `ReactionAction`, `ReactionCondition`, `SafetyGate`, `ReactionContext`, `ReactionAuditEntry` |
| `rules.ts` | `DEFAULT_REACTION_RULES` — hardcoded lifecycle rules |
| `evaluator.ts` | `ReactionEvaluator` — matches events to rules, checks conditions and safety gates |
| `manager.ts` | `ReactionsManager` — orchestrates evaluation, action execution, and audit logging |
| `escalation.ts` | `EscalationManager` — durable timers via Redis ZSET + Hash for timeout escalations |
| `dod-gate.ts` | `evaluateDoDGate` — Definition of Done quality gate for PRs |
| `required-reviewer-gate.ts` | `evaluateRequiredReviewerGate` — verifies PR has approval from required reviewer(s) |
| `index.ts` | Public API barrel export |

## Comment Approved Gate

The `comment_approved` safety gate verifies that the most recent `## Architect Review`
PR comment contains `[APPROVED]` AND was posted by an authorized reviewer AFTER the
current head commit (stale review guard).

This gate replaced `required_reviewer` for single-account pipelines where GitHub
blocks formal review objects from the PR author's own account.

### Configuration

Set the `ARCHITECT_GITHUB_LOGIN` environment variable to the GitHub login of the
Architect account. This is the authoritative source of truth — it overrides any
`reviewers` list in the rule params:

```
ARCHITECT_GITHUB_LOGIN=<GITHUB_USERNAME>   # current single-account setup
# ARCHITECT_GITHUB_LOGIN=yclaw-architect  # when dedicated account is created
```

In `rules.ts`, rule params serve as fallback (used only when env var is absent):
```typescript
{ type: 'comment_approved', params: { reviewers: ['<GITHUB_USERNAME>'] } }
```

### Behavior

- Fetches PR issue comments via `/issues/{pr}/comments` GitHub API
- Finds the most recent comment containing `## Architect Review`
- Checks comment body contains `[APPROVED]`
- Checks commenter login against `ARCHITECT_GITHUB_LOGIN` env var (or params fallback)
- Checks comment timestamp post-dates the PR head commit (stale review guard)
- **Fails closed**: if `ARCHITECT_GITHUB_LOGIN` is unset AND params reviewers empty → fails
- Results cached in Redis for 60s to reduce API calls

### Currently Applied To

- Rule `auto-merge-on-ci-pass` — requires Architect `[APPROVED]` comment
- Rule `auto-merge-on-approval` — requires Architect `[APPROVED]` comment
- Rule `auto-merge-on-architect-comment` — requires Architect `[APPROVED]` comment + CI green

## Required Reviewer Gate

The required reviewer gate (`required-reviewer-gate.ts`) verifies that at least
one APPROVED formal review on a PR comes from a specified set of GitHub usernames.
Introduced after the github-compare.ts incident where code reached master without
qualified review. Not currently used in default rules (single-account pipelines
use `comment_approved` instead).

Key export: `evaluateRequiredReviewerGate(octokit, owner, repo, prNumber, params): RequiredReviewerResult`

### Behavior

- Fetches all reviews on the PR via `octokit.pulls.listReviews()`
- Uses the **latest** review state per user (handles re-reviews correctly)
- A reviewer who approved then requested changes does NOT count as approved
- Case-insensitive username matching
- **Fails closed**: if the API call fails, the gate fails (no merge)
- **Fails closed**: if `reviewers` param is empty or missing, the gate fails
- Ignores COMMENTED and PENDING review states — only APPROVED and CHANGES_REQUESTED are tracked

## Definition of Done (DoD) Gate

The DoD gate (`dod-gate.ts`) evaluates whether a PR meets the minimum quality
bar before automated merge or deployment. It is referenced by the
`dod_gate_passed` safety gate type in reaction rules.

Key export: `evaluateDoDGate(ctx: DoDGateContext): DoDCheckResult`

### Checks

1. **ci_passing** — All CI checks must be green.
2. **type_check** — TypeScript compilation must succeed (no errors).
3. **review_approval** — At least one approving review required.
4. **tests_exist** — Tests must exist for changed files (see below).
5. **no_immutable_changes** — No modifications to restricted paths.
6. **auto_retry_scope** — (auto-retry only) Max 5 files, max 200 lines changed.

### Test Coverage Check

`hasTestCoverage(filesChanged, allFilesInPR)` verifies that every changed
source file (`*.ts`, excluding `*.test.ts` and `*.d.ts`) has a corresponding
test file. It supports two test location conventions:

1. **Colocated**: `src/foo/bar.ts` → `src/foo/bar.test.ts`
2. **tests/ directory**: `packages/core/src/foo/bar.ts` → `packages/core/tests/bar.test.ts`

A source file passes if **either** convention finds a matching test. This
matches the vitest config which uses `tests/**/*.test.ts`.

Non-source files are excluded from the check. If no source files changed,
returns true (tests not required).

### Test Location Convention

Tests live in `packages/core/tests/` (not colocated with source files). The
vitest config (`packages/core/vitest.config.ts`) includes only
`tests/**/*.test.ts`. Do not place new test files next to source — put them
in the `tests/` directory.

### Auto-Retry Scope (Fail-Closed)

When `isAutoRetry` is true, the gate enforces stricter limits:
- Maximum 5 files changed
- Maximum 200 lines changed (additions + deletions)
- `linesChanged` **must be provided** — if undefined, the gate fails (fail-closed)

This prevents automated retries from making unbounded changes.

### Immutable Paths

The following paths are protected and cannot be modified:

```
departments/**
prompts/*.md
packages/core/src/safety/**
packages/core/src/review/**
.github/workflows/**
tsconfig.json
.eslintrc*
.prettierrc*
CLAUDE.md
```

## Escalation Timers (ZSET + Hash Pattern)

The `EscalationManager` (`escalation.ts`) uses a Redis ZSET + companion Hash
pattern for durable timers:

### Data Structures

- **ZSET** (`reaction:escalations`): Stores dedup keys as members with
  due-time as scores. Member format: `{ruleId}:{resource}`.
- **Hash** (`reaction:escalation_data`): Stores full `EscalationEntry`
  payloads keyed by the same member string.

### Why Two Structures

The two-structure pattern provides:
- **O(1) dedup**: Re-scheduling the same `ruleId:resource` replaces the ZSET
  score (and overwrites the Hash entry) — no scan needed.
- **O(log N) polling**: `zrangebyscore('-inf', now)` finds all due entries
  efficiently.
- **Atomic cleanup**: Remove from ZSET first (at-most-once delivery), then
  read and delete from Hash.

### Operations

| Operation | Commands |
|---|---|
| Schedule | `ZADD reaction:escalations <dueAt> <member>` + `HSET reaction:escalation_data <member> <json>` |
| Cancel | `ZREM reaction:escalations <member>` + `HDEL reaction:escalation_data <member>` |
| Poll | `ZRANGEBYSCORE reaction:escalations -inf <now>` → for each: `ZREM` → `HGET` + `HDEL` → execute |

### Delivery Guarantee

At-most-once — the ZSET entry is removed before the action executes. If
execution fails, the entry is already gone. This prevents duplicate
escalation firings at the cost of potential missed escalations on crash.

Escalations survive ECS task restarts because all state is in Redis.

## Default Rules

See `rules.ts` for the full list. Key rules:

| Rule ID | Trigger | Safety Gates | Actions |
|---|---|---|---|
| `ci-failed-on-pr` | `github:ci_fail` | — | Trigger builder to fix, escalate after 30min |
| `changes-requested` | `github:pr_review_submitted` (changes_requested) | — | Trigger builder, escalate after 30min |
| `auto-merge-on-ci-pass` | `github:ci_pass` | all_checks_passed, **comment_approved**, no_merge_conflicts, no_label, dod_gate_passed | Merge PR (CI passed; Architect already commented) |
| `auto-merge-on-approval` | `github:pr_review_submitted` (approved) | all_checks_passed, **comment_approved**, no_merge_conflicts, no_label, dod_gate_passed | Merge PR (formal review; CI already green) |
| `auto-merge-on-architect-comment` | `github:pr_review_comment` (approved) | all_checks_passed, **comment_approved**, no_merge_conflicts, no_label, dod_gate_passed | Merge PR (Architect commented; CI already green) |
| `pr-merged-close-issues` | `github:pr_merged` | — | Close linked issues |
| `new-issue-auto-assign` | `github:issue_opened` | — | Auto-assign agent-work labeled issues |
| `issue-labeled-auto-assign` | `github:issue_labeled` | — | Routes labeled issues to appropriate agents |
| `issue_closed` (PR #345) | `github:issue_closed` | — | Cleans up associated task records in TaskRegistry; transitions to `completed` |

> **Consolidated triggers (PR #330):** Multiple reaction rules were consolidated to reduce redundant event processing and simplify the rule evaluation path.

> **`auto-merge-on-architect-comment`** is the primary merge path for the single-account pipeline. See the Comment Approved Gate section above for details.
