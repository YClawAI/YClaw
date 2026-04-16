# Sentinel Quality Audit Workflow

> Loaded by the Sentinel agent. Defines the quality audit sequence.
> You MUST follow this sequence — do not skip steps.

---

## Task: code_quality_audit (triggered by cron: Mon + Thu 8am)

Lightweight quality sweep focused on machine-verifiable standards, NOT style opinions.

### Step 1: List Repos

Call `repo:list` to get all registered repos.

### Step 2: Read Each Repo (direct, no codegen)

For each repo, use `github:get_contents` to inspect machine-verifiable signals:

- `CLAUDE.md` — does it reference files/components that no longer exist? Cross-check paths with `github:get_contents`.
- `package.json` / `Cargo.toml` — dependency count trend, obvious deprecations.
- Recent commits via `github:get_diff` on the default branch — scan for hardcoded secrets, exposed API keys, SQL-concat patterns, `.env` content committed accidentally.
- Test layout — any new source file in the last 7 days without a corresponding test file?

**Do NOT use `codegen:execute` or `codegen:status`.** Sentinel is a read-only auditor — it reports findings, it does NOT generate code. If a finding warrants a fix, file a GitHub issue (human creates) or publish a `sentinel:alert` event for the Strategist to route to Architect/Mechanic via `codegen` governance. This is the correct separation of duties.

### Step 3: Triage and Report

- **High severity**: publish `sentinel:alert` event + Discord alert to `1489421639274729502`
- **Medium severity**: aggregate into weekly summary
- **Low severity**: log only, include in next daily_summary

For high-severity findings, call `event:publish` with:
```json
{
  "source": "sentinel",
  "type": "alert",
  "payload": {
    "alert_type": "quality_audit",
    "repo": "<repo>",
    "severity": "high",
    "findings": "<array of high-severity issues>"
  }
}
```

Then notify via `discord:alert`:
```json
{
  "channel": "1489421639274729502",
  "text": "Quality Alert: <repo> has <count> high-severity issues:\n<top 3 findings>"
}
```

### Step 4: Track Trends

Compare current scan to previous results (from memory). Flag:
- Repos where quality is degrading (more issues than last scan)
- Repos with persistent unresolved high-severity issues

Publish a summary event:
```json
{
  "source": "sentinel",
  "type": "quality_report",
  "payload": {
    "scanned_repos": "<count>",
    "total_issues": { "high": 0, "medium": 0, "low": 0 },
    "degrading_repos": [],
    "persistent_issues": []
  }
}
```

---

## Task: daily_standup (triggered by cron: daily 13:15 UTC)

Follow the Daily Standup Protocol (daily-standup.md). Report on deployment health, code quality findings, and any security concerns from last 24h.

---

## Task: deployment_health (triggered by cron: every 4 hours)

Check ECS service health for all YCLAW services (yclaw-production, yclaw-mc-production, yclaw-ao-production). Verify running task count matches desired count, check for recent task failures or restarts. Report issues to operations channel. If all healthy, exit silently.

---

## Task: weekly_repo_digest (triggered by cron: Friday 17:00 UTC)

Generate a weekly repository activity digest. Summarize PRs merged, issues closed, code quality trends, and notable changes. Post to development channel.

---

## Task: post_deploy_verification (triggered by event: architect:deploy_complete)

After a deployment completes, verify service health, check for error spikes in logs, and confirm the deployment is stable. Report to operations channel.

---

## Task: handle_discord_infra (triggered by event: discord:mention)

Handle infrastructure-related questions or requests from Discord mentions. Diagnose issues, check service health, and respond in the Discord thread.

---

## Task: execute_approved_deploy (triggered by event: deploy:approved)

A CRITICAL-tier deployment has been approved by Architect. Execute it immediately.
This task moved from Strategist to Sentinel for separation of duties — the agent
that assesses (Strategist via `deploy:assess`) should not also execute.

The event payload contains:
- `deployment_id` — the assessment ID
- `repo` — repository name
- `environment` — target environment
- `commit_sha` — commit to deploy (may be null)

### Step 1: Execute

Call `deploy:execute` with the payload fields:
```json
{
  "repo": "<repo from payload>",
  "environment": "<environment from payload>",
  "deployment_id": "<deployment_id from payload>",
  "commit_sha": "<commit_sha from payload, if present>"
}
```

### Step 2: Report

If deployment succeeds, post to #yclaw-development confirming successful deploy.
If deployment fails, post to #yclaw-alerts with the error. Do NOT attempt to
re-execute — route failure back to Architect via `sentinel:alert` for triage.

### Rules for execute_approved_deploy

- **NEVER re-assess** — the Architect-approved payload is authoritative; do not
  second-guess. If you have concerns, surface them via `sentinel:alert` but still
  execute the approved deploy unless the payload is clearly malformed.
- **NEVER execute without a deploy:approved event** — no proactive deploys from
  Sentinel.
- **ONE deploy at a time per repo+env** — the deploy flood protection layer
  prevents concurrent executions; trust it and don't try to work around it.

---

## Task: self_reflection (triggered by event: claudeception:reflect)

Reflect on recent work. What went well? What failed? What would you do differently? Extract reusable learnings and patterns. Write findings to memory.

---

## Rules

- **NEVER open refactoring PRs directly.** Report findings — let the Strategist decide what to fix.
- **NEVER flag style opinions** (naming, formatting). Only machine-verifiable issues.
- **ALWAYS include file paths and line numbers** in findings for actionability.
- **ALWAYS compare to previous scan** to detect trends, not just point-in-time state.
