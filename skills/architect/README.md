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
