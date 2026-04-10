<!-- CUSTOMIZE FOR YOUR ORGANIZATION -->

# Daily Standup — Development Department

Extends the base standup protocol. Dev agents: your development agents.

## DATA SOURCING RULES (MANDATORY)

When reporting task status, completions, or blockers:
1. You MUST verify current state using tool calls (github:list_issues, task:query, etc.) — NOT from memory
2. Do NOT report "working on X" from memory — verify via tool call that X is actually in progress
3. If you cannot verify a claim, prefix with "UNVERIFIED:" so downstream consumers know
4. Include evidence: PR numbers, issue numbers, deploy IDs — not vague claims

## Your Scan

When triggered by `daily_standup`:

### 1. Check Actual Outputs (via tool calls)
- PRs opened, reviewed, merged in last 24h (with numbers)
- Deploys completed
- Issues closed
- Design reviews done

Do NOT list "processed N tasks" or "maintained quality standards." List specific outputs.

### 2. Verify Blockers (MANDATORY)

Before reporting ANY blocker:
- **Action failures** → call the action right now with a test payload. If it works, DROP the blocker.
- **Missing config/access** → check current state. If resolved, DROP it.
- **Stale issues** → check if the GitHub issue is still open. If closed, DROP it.

Example: If you reported `compare_commits` broken yesterday, try `github:compare_commits` with real params today. If it returns data, it is fixed — do not report it.

### 3. Verify Completions (MANDATORY)

Before reporting anything as "Done":
- **PRs** → verify they are actually merged via github:get_contents or PR status check
- **Issues** → verify they are actually closed
- **Deploys** → verify they are actually completed
- Do NOT report items as "Done" from memory — verify the actual state

### 4. Post to [your-development-channel]

```
[Agent] Standup — YYYY-MM-DD

Done: {PRs, deploys, reviews — with numbers, verified via tool calls}
Blocked: {verified only, or "None"}
Today: {1-3 concrete tasks}
```

### 5. Publish `standup:report` event

Same schema as base protocol.

## Dev-Specific Rules

- **Coding Agent:** Report PR numbers opened. If queue had issues, report current depth via task:query, not historical memory.
- **Architect:** Report PRs reviewed with verdict (approved/changes requested). If no PRs to review, say "No PRs pending" — do not pad.
- **Deploy Agent:** Report deploys completed with IDs. Do not re-report old failures that have been fixed.
- **Designer:** Report design reviews done. If no frontend PRs came in, say so in one line.

## Action Format

`event:publish` — `source`, `type`, `payload` as top-level fields.
`slack:message` — include `channel` ([your-development-channel]) and `text`. Skip if nothing to report.

---

*Maintained by your AI Chief of Staff.*
