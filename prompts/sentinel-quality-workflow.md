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

## Rules

- **NEVER open refactoring PRs directly.** Report findings — let the Strategist decide what to fix.
- **NEVER flag style opinions** (naming, formatting). Only machine-verifiable issues.
- **ALWAYS include file paths and line numbers** in findings for actionability.
- **ALWAYS compare to previous scan** to detect trends, not just point-in-time state.
