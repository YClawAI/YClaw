# Daily Standup Protocol

## DATA SOURCING RULES (MANDATORY)

When generating standup reports:
1. You MUST verify all task statuses, completions, and blockers using tool calls — NOT memory
2. Do NOT report "working on X" or "completed Y" from memory — verify via live tool calls
3. Memory is for learnings and procedures, NOT for current state
4. If you cannot verify a claim via tool call, prefix with "UNVERIFIED:" or omit it

## Overview

Every day, each agent performs a brief morning scan then reports to the Strategist.
Keep it tight — only report what changed. No news is good news.

## Schedule

- **Agents scan:** 13:00 UTC (9:00 AM AST) daily
- **Strategist synthesis:** 13:30 UTC (9:30 AM AST) daily

## Agent Morning Scan

When triggered by `daily_standup`:

### 1. Check Your State (30 seconds, not 30 minutes)
- What did I **actually do** in the last 24h? Only list concrete outputs (PRs, deploys, reviews, posts). Skip "monitoring" and "standing by."
- What **failed**? Only include errors you personally hit, not things you heard about.
- What am I doing **today**? 1-3 bullet points max.

### 2. Verify Blockers Before Reporting
**CRITICAL: Do NOT copy-paste blockers from previous standups.**
Before listing a blocker, you MUST verify it still exists:
- If it is an action failure → try the action NOW (or check recent logs). If it works, it is not a blocker.
- If it is a missing config → check the current config/env. If it is there now, it is not a blocker.
- If it is a repo access issue → try `github:get_contents` on the repo. If it works, drop it.
- If you cannot verify → say "unverified" and skip it from the Slack post.

**Stale blockers waste everyone's time and create false urgency.**

### 3. Slack Post Format

Post to your department channel. Keep it SHORT. No walls of text.

```
[Agent] Standup — YYYY-MM-DD

Done: {2-4 bullets of actual outputs}
Blocked: {only VERIFIED current blockers, or "None"}
Today: {1-3 bullets}
```

That is it. No emojis-per-line. No "Accomplished (last 24h):" headers. No "System Health" sections.
No "Note:" addendums. No repeating your job description. Just the facts.

### 4. Publish Event

Publish a `standup:report` event with:
```json
{
  "agent": "your_name",
  "department": "your_department",
  "date": "YYYY-MM-DD",
  "accomplished_24h": ["concrete outputs only"],
  "blocked": ["verified blockers only"],
  "plan_today": ["1-3 items"]
}
```

Skip `proposed_adaptations` unless you have a specific, actionable change. "Continue monitoring" is not an adaptation.

## Anti-Patterns (DO NOT DO THESE)

- ❌ Reporting the same blocker for 5+ days without trying to fix it or escalating differently
- ❌ Listing "standing by for events" as a plan — that is your default state, not a plan
- ❌ Posting 20+ lines when 5 would do
- ❌ Including "System Health: ✅ Operational" — if you are posting, you are operational
- ❌ Repeating blockers verbatim from yesterday without re-testing
- ❌ Listing things other agents did as your accomplishments
- ❌ "98.8% success rate | 253 total executions" — vanity metrics nobody acts on

## Strategist Synthesis

The Strategist collects standup reports and posts a brief to `#yclaw-executive`:

```
📋 Standup — {date}

Done: {key completions across org, 3-5 bullets}
Blocked: {verified blockers only}
Action needed: {if any}
```

If all agents report nothing notable → Strategist posts: "📋 Standup — {date}: All quiet. No blockers."
Do NOT pad it.

## Self-Modification Rules

| Risk | Examples | Approval |
|------|----------|----------|
| Low | Reprioritizing tasks, tweaking output format | Self-approve, log it |
| Medium | Changing collaboration patterns, modifying schedules | Strategist approves |
| High | Changing safety rules, altering review gates | Human approves |

## Action Format Reference

`event:publish` — pass `source`, `type`, `payload` as **top-level fields** (not nested).
`discord:message` — always include `channel` and `text`. Never send empty messages. If nothing to report, skip the action.

Department channels: `#yclaw-executive`, `#yclaw-development`, `#yclaw-marketing`, `#yclaw-operations`, `#yclaw-finance`, `#yclaw-support`

---

*Last updated: 2026-03-31.*
