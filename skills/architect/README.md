# Architect Skills

Architect is the code quality guardian in the Development department. It reviews pull requests for correctness, security, and style. It also tracks technical debt via weekly scans and reviews CRITICAL-tier deployments.

## Skills

### review-checklist

Standard criteria Architect applies during PR reviews. Organized into two passes:

- **Fast-Pass Review** -- quick checks (description exists, branch naming, no secrets, no debug statements, no unauthorized changes to protected files). Failures trigger an immediate `CHANGES_REQUESTED`.
- **Deep Review** -- code quality, architecture, types/safety, testing, and security (P0). Includes a severity table (P0-P4) for categorizing findings.

Includes a **Cross-Backend QA** rule: when Builder used one codegen backend (e.g., Claude Code), Architect reviews from the perspective of another (e.g., Codex) to catch model-specific blind spots.

**File:** `review-checklist/SKILL.md`

### github-same-account-review-limitation

Documents a GitHub platform constraint discovered in production: formal PR reviews (`POST /pulls/{pr}/reviews`) fail silently when the reviewer and PR author share the same GitHub account.

**Root cause:** GitHub blocks self-reviews. When Architect and Builder run under the same bot account, the `comment_approved` safety gate never fires because no approved review exists.

**Solution:** Use issue comments (`POST /issues/{pr}/comments`) with a structured `## Architect Review` header instead of formal reviews. The `comment_approved` evaluator in `ReactionsManager` parses these comments for `**Status: [APPROVED]**` and checks staleness against the latest commit.

**Affected code paths:**
- `packages/core/src/triggers/github-webhook.ts` -- `handleIssueComment()`
- `packages/core/src/reactions/evaluator.ts` -- `comment_approved` case
- `packages/core/src/actions/github.ts` -- `github:pr_comment` action

**File:** `github-same-account-review-limitation/SKILL.md`

### issue-triage

Rules for `triage_new_issue` (github:issue_opened) and `evaluate_and_delegate` (github:issue_labeled). Covers repo-correctness check, label taxonomy (bug, QA, ao-eligible, needs-human, etc.), strict eligibility contract for AO delegation, and the build-directive payload schema.

**File:** `issue-triage/SKILL.md`

### delegation-policy

Routing table for all task types across AO, Mechanic, and Designer. Includes the decision test (known command + known parameters → Mechanic; reading code + making decisions → AO), payload schemas for `architect:build_directive` vs `architect:mechanic_task`, and 5 immutable routing rules.

**File:** `delegation-policy/SKILL.md`

### deployment-review

Full `review_deploy` procedure: 5-point rubric, the required `deploy:architect_approve` call shape, the advisory `architect:deploy_review` event, and infrastructure-file detection. Reinforces the immutable rule: Architect assesses, Architect never executes.

**File:** `deployment-review/SKILL.md`

### pipeline-health

CI failure classification (flaky vs deterministic vs infrastructure), escalation thresholds, `pipeline_health_scan` cron procedure, and the standup-ready reporting format. Ensures real failures get issues while flaky failures don't create noise.

**File:** `pipeline-health/SKILL.md`

### stale-management

`stale_issue_sweep` cron procedure (simple label filter, no activity inference, max 3 delegations per cycle), stale `in-progress` label reconciliation for failed AO sessions, and the stale PR review escalation ladder (2h re-dispatch → 4h Strategist → 8h close).

**File:** `stale-management/SKILL.md`

## Triggers

| Event | Task |
|---|---|
| `github:pr_opened` | `review_pr` |
| `builder:pr_ready` | `review_pr` |
| `builder:plan_ready` | `review_plan` (complex task shaping review) |
| `deploy:review` | `review_deploy` (CRITICAL-tier deployment review) |
| `strategist:architect_directive` | `architecture_directive` |
| Cron (daily) | `daily_standup` |
| Cron (weekly, Sunday) | `tech_debt_scan` |

## Integration

- Receives PRs from **Builder** and reviews them.
- Shares the `comment_approved` pattern with the **ReactionsManager** for auto-merge gates.
- Reviews CRITICAL-tier deployments requested by **Deployer**.
- Receives directives from **Strategist**.
