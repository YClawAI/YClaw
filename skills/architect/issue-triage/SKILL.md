---
name: issue-triage
description: "Rules for triaging new issues, classifying severity, and routing to the correct agent."
metadata:
  version: 1.0.0
  type: procedure
---

# Issue Triage

> Covers the `triage_new_issue` (github:issue_opened) and `evaluate_and_delegate`
> (github:issue_labeled) tasks. Load this when an issue event arrives.

## Task: triage_new_issue (github:issue_opened)

A new issue was created. **Your ONLY job is to apply labels. Do NOT delegate work.
Do NOT publish `architect:build_directive`.**

### Step 0: Check Repo Correctness (Before Labeling)

1. Call `repo:list` to get all registered repos.
2. Read each repo's registry entry (description, tech_stack, deployment type).
3. Compare the issue title/body against repo topology to determine where the work belongs.

**If the issue is on the WRONG repo:**
1. Post comment: `"This work belongs in {correct-repo}. Moving."`
2. Create the issue on the correct repo via `github:create_issue` (copy title, body, context).
3. Apply label `needs-human` to the original issue with a redirect note.
4. Do NOT label the original as `ao-eligible` or `bug` — do NOT delegate from the wrong repo.
5. Stop. Return.

**If the issue is on the correct repo:** proceed to Step 1.

### Step 1: Apply Labels

1. Read issue title and body from the event payload.
2. Decide labels based on content:

| Label | When to Apply |
|-------|---------------|
| `bug` | Describes a bug, defect, or incorrect behavior |
| `QA` | Describes a test gap, missing test, or quality issue |
| `ao-eligible` | Task AO can handle but isn't a bug or QA issue |
| `needs-human` | Requires human judgment, ambiguous, or touches security/credentials |
| `coordination` | Requires cross-agent or cross-repo coordination |
| `UI` | Requires frontend/design work |
| `security-sensitive` | Touches auth, credentials, permissions, or safety gates |
| `P1` | High priority (production impact, blocking other work) |
| `P2` | Normal priority |

3. Apply labels with `github:add_labels`.
4. Do NOT assign the issue.
5. Do NOT publish any events.

### Label Conflict Rules

- If you apply `needs-human`, do NOT also apply `bug`, `QA`, or `ao-eligible`. `needs-human` takes absolute priority.
- **Bot-created issues:** If created by `yclaw-agent-orchestrator[bot]` or contains `"follow-up from #"`, it's a bot-created follow-up. These are almost always `bug` or `QA` — label accordingly and let the delegation path handle them.

---

## Task: evaluate_and_delegate (github:issue_labeled)

A label was just added to an issue. **Your job: check if eligible for AO delegation,
and if so, publish an `architect:build_directive`.**

### Eligibility Contract (STRICT — do not deviate)

An issue is eligible if ALL of these are true:
- Has at least one eligible label: `bug`, `QA`, or `ao-eligible` (match emoji-prefixed variants like `🐛 bug`, `🧪 QA`, `🤖 ao-eligible`)
- Does NOT have any exclusion label: `needs-human`, `coordination`, `UI`, `security-sensitive` (emoji: `🙅 needs-human`, `🔗 coordination`, `🎨 UI`, `🔒 security-sensitive`)
- Does NOT have `in-progress` (emoji: `🚧 in-progress`) — already being worked
- The label just added (from `label_added` field) is an eligible label — don't re-evaluate old label additions

If not eligible, stop. Return immediately.

### If eligible:

1. Call `ao:status` to check AO health. If degraded or unavailable, stop.
2. Call `github:get_issue` to fetch full issue details.
3. Create a structured directive:
   - `investigation_summary`: What the issue is, root cause analysis
   - `key_files`: Which files likely need changes (use `github:get_contents` to verify paths)
   - `constraints`: What NOT to change, safety boundaries
   - `acceptance_criteria`: How to verify the fix is correct
4. Publish `event:publish` with event `architect:build_directive` containing:
   - All structured fields above
   - `repo` (MUST be full slug `owner/repo`, e.g., `YClawAI/yclaw`)
   - `issueNumber` (integer)

### What NOT to do

- Do NOT check assignees. Assignee is irrelevant.
- Do NOT check comments or branches. You don't have tools for that and don't need them.
- Do NOT delegate more than 1 issue per invocation. You're handling a single label event.
- Do NOT apply labels — the delegation path in the runtime handles `in-progress`.

## See Also

- `delegation-policy/SKILL.md` — which agent to route eligible work to
- `stale-management/SKILL.md` — safety-net sweep that catches missed issues
