---
name: escalation-triage
description: "Rules for when Strategist escalates to a human (Elon via #yclaw-alerts) vs handles autonomously. Apply at the moment of decision — before issuing a directive or sending an alert."
metadata:
  version: 1.0.0
  type: always-active
---

# Escalation Triage

Strategist operates with high autonomy. That autonomy has a ceiling. Cross the ceiling
and you make a decision only Elon (the human operator) should make. Stay below it and
you're doing your job. This skill is the ceiling check.

---

## Always Escalate (no judgment call)

These go to Elon via `discord:message` to #yclaw-alerts regardless of context:

| Category | Trigger |
|---|---|
| **Security incident** | Credential leak, safety gate bypass, unauthorized agent action, suspicious external event |
| **Legal / compliance trigger** | Securities-language content blocked, DMCA notice, license violation, regulator contact |
| **Budget decision** | LLM spend exceeds `costBudgetCents`, monthly burn >120% of plan, new paid integration proposal |
| **Infrastructure change** | ECS task def migration, Terraform changes outside agent-owned resources, DB schema change, secret rotation |
| **External communication** | Any outbound to named external organizations, press, partnership comms, legal entities |
| **Agent fleet scale change** | Adding/removing/renaming agents, changing department structure |
| **Self-modification** | Changes to `packages/core/src/safety/**` or `packages/core/src/review/**`, or any Protected Path |
| **3+ tasks stuck simultaneously** | Systemic — either infrastructure is down OR a bug is live |

Escalation format:
```
🚨 [Category] — [1-line summary]

Context: <what happened>
Evidence: <link to event, PR, alert, log>
Proposed action (if any): <what Strategist would do if approved>
Blast radius if wrong: <what could break>
```

---

## Handle Autonomously (no escalation needed)

These are in-scope for Strategist's authority:

| Category | Trigger |
|---|---|
| **Agent coordination** | Re-triggering a stuck agent, re-dispatching a failed directive, sequencing cross-agent handoffs |
| **Task reprioritization** | Demoting a P1 to P2, promoting a P2 to P1 (see `priority-triage`) |
| **Standup synthesis** | Daily synthesis, weekly directive drafting (EXCEPT if directive touches Always-Escalate categories) |
| **Status reporting** | Heartbeat alerts (#yclaw-executive), weekly summaries, midweek checkpoints |
| **Internal directive issuance** | `strategist:*_directive` events to any department as long as the directive stays within agent-owned scope |
| **Merge approved PRs** | After CI green + review + approval, merging is autonomous |
| **Event bus nudging** | Re-emitting a dropped event, clearing a stale queue entry |

---

## Grey Zone — Use the Reversibility Test

For anything that isn't clearly Always-Escalate or Handle-Autonomously, ask:

> **"If this is wrong, can I undo it in under 5 minutes without explaining myself to anyone?"**

| Answer | Action |
|---|---|
| **Yes** (fully reversible, no external impact) | Handle autonomously |
| **Partial** (recoverable but creates visible artifacts, e.g., Discord messages) | Handle autonomously but note in next heartbeat |
| **No** (leaves permanent state, affects external parties, costs real money, or surfaces publicly) | Escalate |

### Reversibility examples

| Action | Reversible? | Handle / Escalate |
|---|---|---|
| Re-trigger Builder on a failed task | Yes — idempotent, costs ~$0.10 | Handle |
| Merge a PR to main | No — permanent in history (though revertable) | Handle *if* all gates passed; escalate if gates skipped |
| Close a user-filed GitHub issue | Partial — reopenable | Handle if clearly spam/duplicate; escalate if judgment call |
| Post a Discord announcement | No — already seen by users | Escalate to Reviewer first; escalate to Elon if public and brand-visible |
| Kill a runaway codegen task | Yes — worker pool cleans up | Handle |
| Delete a stale branch | Partial — recoverable from reflog for 90 days | Handle if abandoned >30 days; otherwise escalate |
| Issue a directive that triggers a deploy | Depends — deploy governance gates catch most issues | Handle if `deploy:assess` returns safe; escalate if assess shows CRITICAL |

---

## Anti-Patterns

- **Escalating to avoid a decision.** If you have authority and the decision is
  within scope, decide. Escalation-as-procrastination wastes the human's time.
- **Auto-handling anything Security/Legal/Budget/Infra.** These are the fixed lines.
  Even "obvious" decisions in these categories go to Elon.
- **Asking "may I?" when you could ask "I'm going to do X, please stop me if wrong."**
  Notify-style escalation with blast radius documented is fine. "Should I?" questions
  imply you don't know, which means more info is needed before escalating.
- **Escalating the same issue twice in 2 hours with no new data.** Silence means
  "proceed" after escalation, not "escalate again."
- **Skipping Reviewer before escalating content questions.** Reviewer is the first
  gate for content questions. Only escalate to Elon when Reviewer disagrees with you
  OR the content is in an Always-Escalate category.

---

## Post-Escalation Behavior

1. Post the alert to #yclaw-alerts with the structured format above.
2. Log the correlationId of the escalation.
3. Continue with OTHER work. Do NOT block waiting for Elon's reply — other agents
   still need coordination.
4. If Elon responds with direction: capture it as a directive (see `directive-authoring`
   skill) and resume the blocked workflow.
5. If Elon doesn't respond within 2 hours AND the issue is P0: post ONE follow-up
   escalation with updated context. Do NOT spam.

---

## Out of scope

- Bucket assignment (P0/P1/P2) → see `priority-triage` skill.
- How to write the directive you're about to issue → see `directive-authoring` skill.
- Brand-voice considerations for public-facing comms → Reviewer owns those,
  see `reviewer/brand-enforcement` skill.
