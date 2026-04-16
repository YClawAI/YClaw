---
name: pipeline-health
description: "How to classify and respond to CI/pipeline failures."
metadata:
  version: 1.0.0
  type: procedure
---

# Pipeline Health

> Triggered by the `pipeline_health_scan` cron (every 3h) and on ad-hoc inspection of
> `github:ci_fail` events. Goal: detect broken pipelines quickly, separate flaky from
> deterministic failures, and escalate before the backlog grows.

## Failure Classification

### Flaky (transient, likely retryable)
- Same job passes on rerun within 1 hour
- Error message references network timeouts, upstream API 5xx, Docker Hub rate limits
- Only one run has failed in the last 5
- Heartbeat-style tests (port bind race conditions, clock skew) without a code change

**Response:** Note in report, do NOT delegate a fix. If it recurs 3+ times in 24h, upgrade to deterministic.

### Deterministic (real failure, needs action)
- Same job fails on rerun with same error
- Error references compilation, type check, lint rule, or assertion failure
- 3+ consecutive failures
- Failure started immediately after a merge (correlate with `git log`)

**Response:** Create `bug` issue with CI failure context. Include: failing job name, commit sha of first failure, stderr excerpt (first 500 chars), link to workflow run. Delegate via `evaluate_and_delegate` flow.

### Infrastructure (platform-level, escalate)
- GitHub Actions reports "Service unavailable"
- Runner pool exhausted (queue time > 30 min)
- OIDC federation failure (auth error from AWS)
- Artifact upload timing out repeatedly

**Response:** Post to Discord `#yclaw-alerts` with severity HIGH. Do NOT create agent-delegatable issues. Publish `sentinel:alert` if downstream deploys are blocked.

## Escalation Thresholds

| Condition | Threshold | Action |
|-----------|-----------|--------|
| Same repo's CI broken | 2+ hours | Post to `#yclaw-alerts`, create `P1 bug` issue |
| Deploy pipeline broken | 1+ hour | Post immediately, escalate to Strategist |
| Multiple repos' CI broken simultaneously | 30 min | Infrastructure-level; escalate to human |
| Flaky test failure recurring | 3+ times in 24h | Reclassify as deterministic, delegate |

## Scan Procedure (pipeline_health_scan cron)

1. Call `repo:list` to get all registered repos.
2. For each healthy repo, query recent workflow runs (last 24h).
3. Classify any failed runs into flaky / deterministic / infrastructure.
4. For deterministic failures: create an issue labeled `bug` + `P1` or `P2` based on impact. Let `evaluate_and_delegate` handle delegation on the next label event.
5. For infrastructure failures: post to Discord.
6. For flaky: log the frequency. If a specific test has failed 3+ times in 24h, upgrade to deterministic and create an issue.

## Reporting Format

When reporting pipeline health (in standup or scan summary):

```
Pipeline Health Report — {repo-name}

Recent runs: {N total, M failed}
Deterministic failures: {count, list of commit SHAs}
Flaky failures: {count, list of test names + retry outcomes}
Infrastructure alerts: {count}

Actions taken:
- Created issue #{N} for {failure}
- Posted #yclaw-alerts for {infra issue}

Health verdict: GREEN | YELLOW | RED
```

## See Also

- `issue-triage/SKILL.md` — for labeling any issues you create from CI failures
- `delegation-policy/SKILL.md` — for routing CI-failure fixes to AO vs Mechanic
- `deployment-review/SKILL.md` — deploys should never approve while CI is RED
