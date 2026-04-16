---
name: stale-management
description: "Rules for detecting and managing stale issues and PR reviews."
metadata:
  version: 1.0.0
  type: procedure
---

# Stale Management

> Covers the `stale_issue_sweep` cron task. A safety-net that catches issues missed by
> real-time event triggers (`github:issue_opened`, `github:issue_labeled`) and
> reconciles stale `in-progress` labels left behind by failed AO sessions.

## Operating Principle

This is a **SIMPLE label filter**. Do NOT infer activity. Do NOT check comments,
branches, or commits. Do NOT use assignee as a signal.

## Task: stale_issue_sweep

### Steps

1. Call `ao:status`. If AO is degraded, queue depth > 5, or unavailable, stop immediately. Return `"AO not ready, skipping sweep."`
2. Use `repo:list` to get all registered repos. For each healthy repo, call `github:list_issues` with `state: open`.
3. **Stale in-progress reconciliation:** For any issue labeled `in-progress` that was updated more than 3 hours ago (check `updated_at`), the AO session likely failed without a callback. Remove the `in-progress` label via `github:remove_label` so the issue becomes eligible again. Log a warning: `"Removed stale in-progress from #N (last updated {time})."`
4. For each issue (excluding those still validly `in-progress`), evaluate eligibility using ONLY labels:
   - **Eligible** = has label `bug`, `QA`, or `ao-eligible` (match emoji-prefixed variants)
   - **Excluded** = has label `needs-human`, `coordination`, `UI`, `security-sensitive`, or `in-progress`
   - **Eligible AND NOT Excluded** = candidate for delegation
5. From eligible candidates, select up to **3** (prioritize P1 over P2, then oldest first by issue number).
6. For each selected issue: call `github:get_issue`, create a structured directive (same format as `evaluate_and_delegate`), publish `architect:build_directive` via `event:publish`.
7. Report what you did: `"Delegated N issues: #X, #Y, #Z"` or `"No eligible issues found"` or `"AO not ready, skipping."`. Include any stale in-progress labels that were removed.

### Rules

- **Maximum 3 delegations per sweep cycle.** Do not flood AO.
- **IGNORE assignee field completely** — it is not a signal.
- **IGNORE issue comments** — you cannot read them.
- **IGNORE branch existence** — you cannot check it.
- If an issue has both an eligible label AND an exclusion label, the **exclusion label wins** (skip it).
- If no issues were delegated and AO was available, do NOT post to Discord. **Silent sweeps are expected behavior.**

## Stale PR Review Detection

In addition to issues, Architect is responsible for chasing down its own stale PR feedback.

### When a PR Review is Stale

- Architect requested changes on a PR
- More than 2 hours have passed since the review
- No new commits have appeared on the PR branch
- No response from AO/Mechanic via events

### Response Ladder

| Age | Action |
|-----|--------|
| 2h | Re-dispatch the `architect:build_directive` with the original feedback |
| 4h | Escalate via `strategist:architect_directive` asking Strategist to reassign |
| 8h | Close the PR with comment: `"Closed due to stale review. Please reopen with the requested changes."` |

### Anti-Pattern

Do NOT "re-approve" a PR with unresolved review feedback just because it's old.
Old + unresolved = closer to closing, not closer to merging.

## See Also

- `issue-triage/SKILL.md` — the real-time path that this sweep backs up
- `delegation-policy/SKILL.md` — for directives published during the sweep
- `pipeline-health/SKILL.md` — AO health check that gates the sweep
