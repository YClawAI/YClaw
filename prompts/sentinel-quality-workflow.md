<!-- CUSTOMIZE FOR YOUR ORGANIZATION -->

# Sentinel Quality Audit Workflow

> Loaded by the Sentinel agent. Defines the quality audit sequence.
> You MUST follow this sequence — do not skip steps.

---

## Task: code_quality_audit (triggered by cron: Mon + Thu 8am)

Lightweight quality sweep focused on machine-verifiable standards, NOT style opinions.

### Step 1: List Repos

Call `repo:list` to get all registered repos.

### Step 2: Quick Scan Each Repo

For each repo, call `codegen:execute` with:
```json
{
  "repo": "<repo name>",
  "task": "Quick quality audit. Check ONLY machine-verifiable issues:\n1. CLAUDE.md staleness — does it reference files/components that no longer exist?\n2. Broken imports — any imports that point to missing modules?\n3. Dead exports — exported functions/types with zero consumers?\n4. Test coverage gaps — new files without corresponding test files?\n5. Security: hardcoded secrets, exposed API keys, SQL injection vectors?\n\nOutput as JSON: { repo, issues: [{ severity: 'high'|'medium'|'low', file, line, description }] }",
  "run_tests": false,
  "backend": "claude",
  "agent_name": "sentinel"
}
```

### Step 3: Triage and Report

- **High severity**: publish `sentinel:alert` event + Slack alert to [your-development-channel]
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

Then notify via Slack:
```json
{
  "channel": "[your-development-channel]",
  "text": "Quality Alert: <repo> has <count> high-severity issues:\n<top 3 findings>",
  "username": "Sentinel",
  "icon_emoji": ":shield:"
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

## Task: post_deploy_verification (triggered by event: deployer:deploy_complete)

After a deployment completes, verify service health, check for error spikes in logs, and confirm the deployment is stable. Report to operations channel.

---

## Task: handle_discord_infra (triggered by event: discord:mention)

Handle infrastructure-related questions or requests from Discord mentions. Diagnose issues, check service health, and respond in the Discord thread.

---

## Task: self_reflection (triggered by event: claudeception:reflect)

Reflect on recent work. What went well? What failed? What would you do differently? Extract reusable learnings and patterns. Write findings to memory.

---

## Rules

- **NEVER open refactoring PRs directly.** Report findings — let the Strategist decide what to fix.
- **NEVER flag style opinions** (naming, formatting). Only machine-verifiable issues.
- **ALWAYS include file paths and line numbers** in findings for actionability.
- **ALWAYS compare to previous scan** to detect trends, not just point-in-time state.
