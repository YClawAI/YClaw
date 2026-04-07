---
name: github-same-account-review-limitation
description: "GitHub blocks formal PR reviews when PR author and reviewer share the same GitHub account. Use PR issue comments with a structured header instead."
metadata:
  version: 1.0.0
  type: reference
  discovered: 2026-02-25
  verified: true
---

# GitHub Same-Account PR Review Limitation

## Problem

When Architect (agent account) tries to submit a **formal PR review** on a PR
that was also created by the same GitHub account, GitHub's API returns an error
or silently rejects the review. This is a GitHub platform constraint — you cannot
formally approve your own PR.

This manifests as the `comment_approved` safety gate never firing, because no
approved review exists in `/pulls/{pr}/reviews`.

## Root Cause

GitHub has **two separate review mechanisms** that hit different API endpoints
and fire different webhooks:

| Mechanism | API Endpoint | Webhook Event | Same-Account Works? |
|-----------|-------------|---------------|---------------------|
| Formal PR review | `POST /repos/{owner}/{repo}/pulls/{pr}/reviews` | `pull_request_review` | **NO — blocked by GitHub** |
| PR issue comment | `POST /repos/{owner}/{repo}/issues/{pr}/comments` | `issue_comment` | YES |

The `pull_request_review` webhook and `/pulls/{pr}/reviews` endpoint enforce
that the reviewer cannot be the same user who opened the PR. This silently
fails or returns an error when Architect and Builder share a GitHub account
(e.g., both running under the same org bot account, or during same-account pipelines).

## Trigger Conditions

- Architect is wired to call `github:pr_review` (formal review) action
- Architect's GitHub identity == Builder's GitHub identity (same account)
- Auto-merge rules use `comment_approved` or `pr_approved` safety gates
- The `comment_approved` gate polls `/pulls/{pr}/reviews` and finds nothing

## Solution

Use `github:pr_comment` (issue comment) instead of `github:pr_review` for
Architect's review output, combined with a structured `## Architect Review`
header that the `comment_approved` evaluator can parse.

### Architect Action

```yaml
# In Architect's agent config or prompt instructions:
# Use pr_comment, NOT pr_review
action: github:pr_comment
params:
  body: |
    ## Architect Review

    [Review findings here]

    **Status: [APPROVED]**
    # or: **Status: [CHANGES REQUESTED]**
```

### Webhook Handler

The `issue_comment` webhook fires for these comments. The
`GitHubWebhookHandler.handleIssueComment()` method detects the `## Architect Review`
header and re-emits the event as `github:pr_review_comment` on the internal
event bus:

```typescript
// packages/core/src/triggers/github-webhook.ts
private async handleIssueComment(payload: IssueCommentPayload) {
  // Only process PR comments (issue_comment fires for both issues and PRs)
  if (!payload.issue.pull_request) return { processed: false };
  // Detect structured Architect review comments
  if (!comment.body.includes('## Architect Review')) return { processed: false };
  // Publish as internal review event
  await this.eventBus.publish('github', 'pr_review_comment', { ... });
}
```

### Safety Gate

The `comment_approved` condition in `ReactionsManager` evaluator polls
`/issues/{pr}/comments` (NOT `/pulls/{pr}/reviews`) and looks for:

1. A comment body containing `## Architect Review`
2. The comment containing `**Status: [APPROVED]**` (case-sensitive)
3. The comment was posted AFTER the latest commit to the PR head (staleness check)

```typescript
// packages/core/src/reactions/evaluator.ts
case 'comment_approved': {
  const comments = await github.listIssueComments(owner, repo, prNumber);
  const architectComments = comments
    .filter((c) => c.body.includes('## Architect Review'));
  // Check for [APPROVED] status in most recent comment
  // Check comment is newer than latest commit
}
```

## What NOT to Do

- Do NOT use `github:pr_review` action for same-account pipelines — it will
  fail silently and the `pr_approved` gate will never pass.
- Do NOT poll `/pulls/{pr}/reviews` for same-account Architect approvals — use
  `/issues/{pr}/comments` instead.
- Do NOT use `pr_approved` safety gate (which checks formal reviews) — use
  `comment_approved` instead.

## Affected Files

- `packages/core/src/triggers/github-webhook.ts` — `handleIssueComment()`
- `packages/core/src/reactions/evaluator.ts` — `comment_approved` case
- `packages/core/src/reactions/rules.ts` — rules 3 and 4 use `comment_approved`
- `packages/core/src/triggers/event-schemas.ts` — `github:pr_review_comment` event
- `packages/core/src/actions/github.ts` — `github:pr_comment` action
