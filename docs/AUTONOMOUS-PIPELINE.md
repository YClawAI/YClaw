# Autonomous Deploy Pipeline

> **Status:** Fully operational as of 2026-03-03 (verified with PR #291)
> **Last updated:** 2026-03-24

## Overview

The YClaw Agents autonomous pipeline handles the full lifecycle from PR creation
to production deployment with zero human intervention. A developer (or agent) opens
a PR, Architect reviews it, ReactionsManager auto-merges on approval, CI builds,
and Deployer pushes to ECS.

```
PR opened
  → Architect reviews → posts [APPROVED] comment
    → ReactionsManager auto-merges (squash)
      → CI on master → ci_pass with pr_url
        → Deployer assesses → compare_commits → risk tier
          → deploy:execute (or Architect review for CRITICAL)
```

## Detailed Flow

### Phase 1: PR Review

1. Developer pushes branch and opens PR
2. GitHub sends `pull_request` (action: `opened`) webhook
3. Webhook path: GitHub → API Gateway → WAF (`allow-github-webhook`) → Lambda proxy (`yclaw-github-webhook-proxy`) → ECS app `/github/webhook`
4. `handlePullRequest` publishes `github:pr_opened` event to EventBus
5. Agent router triggers `architect:review_pr`
6. Architect reads the diff via `github:get_contents`, classifies the change
7. Architect posts a PR comment: `## Architect Review` + `**Status: [APPROVED]**` (or `[CHANGES REQUESTED]`)

### Phase 2: Auto-Merge

8. Architect's comment triggers an `issue_comment` (action: `created`) webhook from GitHub
9. `handleIssueComment` in `github-webhook.ts`:
   - Checks the PR has a `pull_request` field (filters out non-PR issue comments)
   - Checks commenter is in `ARCHITECT_GITHUB_LOGINS` env var (currently: `<GITHUB_USERNAME>`)
   - Scans comment body for `[APPROVED]` or `[CHANGES REQUESTED]`
   - Publishes `github:pr_review_comment` event with `review_state: 'approved'`

> **Design note — event naming:** We intentionally publish `github:pr_review_comment`
> from `handleIssueComment`, not `github:issue_comment`. This is because GitHub blocks
> same-account formal PR reviews (<GITHUB_USERNAME> can't approve its own PRs). The Architect
> uses structured comments as a substitute for formal reviews. The event name reflects
> the *semantic meaning* (a review decision) not the webhook source.

> **Loop prevention:** The `ARCHITECT_GITHUB_LOGINS` allowlist serves double duty:
> identity verification AND recursion guard. Only comments from approved architect
> logins are promoted to merge events. If Builder or any other agent posts a comment
> containing `[APPROVED]`, it is ignored because the author is not in the allowlist.

10. EventBus dispatches `github:pr_review_comment` to **all** registered handlers (sequential, per-handler try/catch):
    - **ReactionsManager** evaluates rule `auto-merge-on-architect-comment`
    - **Agent router** triggers `builder:address_review_feedback`
11. ReactionsManager checks safety gates:
    - `ci_green` — PR CI checks passed
    - `all_checks_passed` — all GitHub status checks green
    - `comment_approved` — recent `[APPROVED]` comment from `<GITHUB_USERNAME>`
    - `no_merge_conflicts` — PR is mergeable
    - `no_label` — no `do-not-merge` label
    - `dod_gate_passed` — Definition of Done gate (deploy readiness checks)
12. If all gates pass: `github:merge_pr` (squash merge) → Slack notification to `#yclaw-development`

### Phase 3: Build & Deploy

13. Merge to master triggers GitHub Actions CI (`Build & Deploy YClaw Agents`)
14. GitHub sends `workflow_run` (action: `completed`) webhook
15. `handleWorkflowRun` in `github-webhook.ts`:
    - Checks conclusion is `success` and branch is `master`
    - Enriches event by resolving PR URL via `GET /repos/{owner}/{repo}/commits/{sha}/pulls` (PR #282 fix)
    - Publishes `github:ci_pass` with `pr_url`
16. Deployer receives `ci_pass` → runs `deploy:assess`:
    - Calls `github:compare_commits` to diff deployed vs incoming commits
    - Classifies file-path risk: LOW (`.md`/`.yaml`) → auto-approve, HIGH (`.ts`/`.js`) → Architect review, CRITICAL (creds/infra) → council + human
17. `deploy:status` action returns current deploy state (now implemented; was previously unbuilt)
18. `deploy:execute` registers new ECS task definition and updates service
    - The redundant human approval gate on `deploy:execute` has been removed; the deploy governance pipeline (risk-classifier → Architect review) is sufficient

### Executor Selection

The worker executor is selected per-task by `CodingExecutorRouter`:

1. `executorHint='pi'` → `PiCodingExecutor` (in-process Pi SDK, requires `PI_CODING_AGENT_ENABLED=true`)
2. `executorHint='cli'` → `SpawnCliExecutor` (local process spawn — default)

### Designer Workflow

- Stitch generation path via `strategist:design_generate` event routes to Designer
- Design Studio UI component in Mission Control

## Infrastructure

| Component | Value |
|---|---|
| ECS Cluster | `yclaw-cluster-production` |
| ECS Service | `yclaw-production` |
| Task Definition | `yclaw-production` (2 containers: `yclaw` app + `litellm` sidecar) |
| Lambda Proxy | `yclaw-github-webhook-proxy` (arm64, Node 22, 128MB) |
| API Gateway | `<API_GATEWAY_ID>` |
| WAF Rule | `allow-github-webhook` (priority 0) |
| GitHub Webhook | Configured on `yclaw-ai/yclaw` |
| Webhook Events | `pull_request`, `pull_request_review`, `workflow_run`, `issues`, `issue_comment` |
| Redis | Event bus for inter-agent pub/sub |

### Key Environment Variables (task definition)

| Variable | Purpose |
|---|---|
| `REACTION_LOOP_ENABLED` | `true` — enables ReactionsManager at startup (`main.ts:219`) |
| `ARCHITECT_GITHUB_LOGINS` | `<GITHUB_USERNAME>` — allowlist for comment-based PR approval |

## EventBus Architecture

The EventBus uses Redis pub/sub for cross-process communication with local dispatch
to multiple handlers per event pattern.

```typescript
// handlers stored as Map<string, handler[]> (PR #285)
// dispatch is SEQUENTIAL with per-handler try/catch:
for (const handler of handlers) {
  try {
    await handler(event);
  } catch (err) {
    this.log.error('Event handler failed', { pattern, eventKey, error });
  }
}
```

**Key property:** One handler failing does not prevent subsequent handlers from executing.
Both ReactionsManager and agent router receive every matching event.

## ReactionsManager Rules (9 total)

| # | Rule ID | Trigger Event | Purpose |
|---|---------|---------------|---------|
| 1 | `ci-failed-on-pr` | `github:ci_fail` | Notify on PR CI failure |
| 2 | `changes-requested` | `github:pr_review_submitted` | Route review feedback |
| 2b | `auto-update-behind-branch` | `github:ci_pass` | **Auto-update PR branch** when behind master (strict checks) |
| 3 | `auto-merge-on-ci-pass` | `github:ci_pass` | Merge when CI passes + comment_approved + branch_up_to_date |
| 4 | `auto-merge-on-approval` | `github:pr_review_submitted` | Merge on formal approval + CI green + branch_up_to_date |
| 5 | `pr-merged-close-issues` | `github:pr_merged` | Close linked issues on merge |
| 6 | `auto-merge-on-architect-comment` | `github:pr_review_comment` | **Primary merge path** — comment-based approval + branch_up_to_date |
| 7 | `new-issue-auto-assign` | `github:issue_opened` | Auto-route issues to Builder |
| 8 | `issue-labeled-auto-assign` | `github:issue_assigned` | Route labeled issues |

**Rule #6 is the primary merge path** for the single-account pipeline. Rules #3 and #4
exist for multi-account setups where formal GitHub reviews are possible.

### Auto-Update Behind Branch (Rule 2b)

Branch protection has **strict status checks** — the PR branch must be up-to-date with
`master` before merging. When commits land on master, open PRs fall behind and auto-merge
rules silently fail because GitHub rejects the merge API call.

**Flow:**
1. CI passes on PR → `auto-update-behind-branch` fires (branch behind, approved)
2. Calls GitHub `PUT /pulls/{pr}/update-branch` with `expected_head_sha`
3. CI re-runs on updated branch → `auto-merge-on-ci-pass` fires (branch now `clean`)
4. PR merges

**Safety:**
- `branch_up_to_date` gate added to all 3 merge rules — prevents merge attempts on behind branches
- Redis counter `reaction:branch-update:{owner}:{repo}:{pr}` caps at 3 updates per PR per hour (1h TTL)
- Existing 5-minute dedup lock prevents the update rule from re-firing before CI completes

## File-Path Risk Classification (Deploy Governance)

| Risk Tier | File Patterns | Governance |
|---|---|---|
| LOW | `.md`, `.yaml`, `.json`, docs/ | Auto-approve, fast-track deploy |
| HIGH | `.ts`, `.js`, `.tsx`, source code | Architect review required |
| CRITICAL | Credentials, infra, CI/CD, Terraform | Council review + human approval |

## Security Considerations

- **Single-account pipeline:** `<GITHUB_USERNAME>` is the only GitHub account. GitHub blocks
  same-account formal PR reviews. Comment-based review via structured comments is the
  workaround. `ARCHITECT_GITHUB_LOGINS` gates which accounts' comments trigger merges.
- **Webhook HMAC:** Lambda proxy validates `X-Hub-Signature-256` against shared secret.
  WAF pre-filters by GitHub IP ranges.
- **Branch protection:** CI status checks required (strict — branch must be up to date).
  PR reviews NOT required (single-account cannot self-approve).
- **Outbound safety:** `CREDENTIAL_PATTERNS` hard-block on all outbound actions.
  `EXFIL_PATTERNS` audit-logged for semi-trusted actions (GitHub, Slack).

## Safety Mechanisms

- **Elvis deterministic pre-check:** Zero-LLM heartbeat gating — queries Redis for pending work, skips if none ($0.00 cost)
- **CI config validation safety net:** Validates YAML against Zod schema, graceful degradation via `safeParse()`
- **ReviewGate updated:** Fails-open by default with retry + integrated secret scanning

## Fixes Shipped (2026-03-03)

| PR | Fix | Root Cause |
|---|---|---|
| #274 | `github:compare_commits` wired into executor + schemas | Action code existed but never registered in `ACTION_SCHEMAS` or executor switch |
| #278 | LiteLLM OpenRouter load balancing + cross-provider fallbacks | Zero fallback models; Anthropic overload killed all Builder tasks |
| #280 | Deploy flood protection (Redis dedup, concurrency lock) | Thundering herd: every CI event spawned parallel deploy attempts |
| #282 | `ci_pass` enriched with `pr_url` via commits API | `pr_required` DoD gate always null — workflow_run webhook has no PR context |
| #285 | EventBus `Map<string, handler>` to `Map<string, handler[]>` | Second subscriber overwrote first; ReactionsManager never received events |
| #290 | `merge_pr` params mapped (owner, repo, pullNumber) | Reaction rule action did not extract params from event payload |
| #308 | Auto-update PR branches behind master + `branch_up_to_date` gate | Strict checks require up-to-date branch; approved PRs couldn't merge after other merges |
| #309 | Slack alert dedup (Redis fingerprint) + DLQ alert batching | Zero dedup on agent direct posting; heartbeats posted duplicate alerts every cycle |

## Journaler (GitHub Coordination Ledger)

The Journaler (`src/modules/journaler.ts`) subscribes to `coord.*` events via
Redis Streams consumer group `journaler` and writes milestone events as Markdown
comments on GitHub project issues.

### Event Classification

| Category | Event Types | Action |
|---|---|---|
| **Milestone** | `coord.deliverable.submitted`, `coord.deliverable.approved`, `coord.deliverable.changes_requested`, `coord.review.completed`, `coord.task.blocked`, `coord.task.completed`, `coord.task.failed`, `coord.project.kicked_off`, `coord.project.phase_completed`, `coord.project.completed` | Post GitHub comment |
| **Noise** | `coord.task.requested`, `coord.task.accepted`, `coord.task.started`, `coord.status.*` | Silently ignored |

### Issue Mapping

- **`coord.project.kicked_off`** creates a new GitHub issue titled `[Project] {name}`
  with label `coordination`. Maps `correlation_id` → issue number in Redis hash
  `journaler:project_issues` (30-day TTL).
- Subsequent events with the same `correlation_id` post comments on the mapped issue.
- Events with no mapping fall back to a default `[Coordination] Event Log` issue
  (created once, cached in Redis key `journaler:default_issue`).

### Safety

- **Rate limit:** Max 1 GitHub comment per 2 seconds (queued).
- **Loop prevention:** All comments include `<!-- yclaw-journaler -->` marker.
  Both `handleIssueComment` in `github-webhook.ts` and `ReactionsManager` skip
  comments containing this marker.
- **Crash resilience:** All GitHub API calls wrapped in try/catch — errors are
  logged but never crash the Journaler or block the event stream.

## SlackNotifier (Coordination Event → Slack Channels)

The SlackNotifier (`src/modules/slack-notifier.ts`) subscribes to `coord.*` events
via Redis Streams consumer group `slack-notifier` and posts Block Kit messages to
department-specific Slack channels.

Slack is a **display-only** notification surface — agents coordinate via events,
not via Slack messages. The previous `strategist:slack_delegation` inter-agent
coordination pattern has been removed.

### Channel Routing

Events are routed based on the source agent's department:
- `builder` (development) → `#yclaw-development`
- `ember` (marketing) → `#yclaw-marketing`
- `strategist` (executive) → `#yclaw-executive`
- Unknown agents → `#yclaw-general` (fallback)

### Thread Grouping

Events sharing a `correlation_id` are threaded in Slack:
- First event → new message, `thread_ts` saved to Redis (7-day TTL)
- Subsequent events → reply in the existing thread

### Escalations

`coord.task.blocked`, `coord.task.failed`, and `coord.project.completed` are posted
to both the department channel AND `#yclaw-alerts`.

### Safety

- **Rate limit:** Max 1 message per second per channel
- **Crash-safe:** All Slack API calls in try/catch — errors logged, never crash

## Slack Alert Dedup (Agent Direct Posting)

The `SlackNotifier` (coord events → Slack) has threading and rate limiting, but the
**agent direct posting path** (`slack:message`/`slack:alert` tool calls from LLM loops)
previously had zero deduplication. Agents posting the same alert every heartbeat cycle
caused alert flooding (#yclaw-alerts had 6+ duplicate messages in 2 hours).

### How It Works

1. Every `slack:message` and `slack:alert` call is fingerprinted: SHA-256 of
   `channel + normalized_text` (strips UUIDs, timestamps, deploy IDs, commit SHAs,
   and volatile counts like "28 tasks" → "N tasks")
2. Redis `SET NX` with channel-specific TTL — if fingerprint exists, message is
   silently suppressed (returns `success: true` so agent doesn't retry)
3. Fail-open: Redis errors allow the message through

### Channel-Specific Dedup Windows

| Channel | Channel ID | TTL | Rationale |
|---|---|---|---|
| #yclaw-alerts | (your channel ID) | 2 hours | Highest dedup — alert fatigue prevention |
| #yclaw-executive | (your channel ID) | 1 hour | Status updates, not urgent |
| #yclaw-development | (your channel ID) | 30 min | More frequent updates acceptable |
| #yclaw-marketing | (your channel ID) | 30 min | Same as development |
| (other channels) | — | 1 hour | Default TTL |

### DLQ Alert Batching

Builder DLQ failure alerts are batched instead of posted individually. The
`BuilderDispatcher` buffers DLQ entries and flushes as a single consolidated
message after 5 entries or 60 seconds, whichever comes first.

### Redis Keys

| Key Pattern | Type | TTL | Purpose |
|---|---|---|---|
| `slack:dedup:{fingerprint}` | String | Channel-specific (1800–7200s) | Message dedup fingerprint |

### Infrastructure

SlackExecutor receives a dedicated Redis client (`slackDedupRedis`) at construction
time in `main.ts`. Optional — if Redis is unavailable, dedup is disabled (messages
pass through).

## Known Issues

| Issue | Impact | Mitigation |
|---|---|---|
| ~~Rolling deploys SIGTERM active tasks~~ | ~~Agent tasks killed mid-execution~~ | **Resolved** — `stopGracefully()` re-queues incomplete tasks on SIGTERM + startup recovery re-enqueues orphans |
| Fire-and-forget events | Events during container restart are lost | Partially mitigated by Redis Streams PEL replay |
| ~~Builder DLQ no auto-retry~~ | ~~27+ tasks stuck after provider recovery~~ | **Resolved** — DLQ auto-retry with exponential backoff (5m→10m→20m), 3 attempts max, permanent flag after exhaustion |
| ~~PRs stuck behind master after other merges~~ | ~~Approved PRs can't merge — strict checks require up-to-date branch~~ | **Resolved** — `auto-update-behind-branch` rule calls GitHub Update Branch API, `branch_up_to_date` gate prevents premature merge attempts |
| ~~Slack alert flooding from agent heartbeats~~ | ~~6+ duplicate alerts in #yclaw-alerts within 2 hours~~ | **Resolved** — Redis-based message dedup in SlackExecutor (fingerprint + SET NX), DLQ alerts batched (5 entries or 60s) |
| Docs-only changes trigger full deploy | Container restarts for `.md` changes | Could skip ECS deploy for docs-only |
