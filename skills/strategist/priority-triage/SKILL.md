---
name: priority-triage
description: "Triage incoming tasks, alerts, and events into P0/P1/P2 buckets. Use whenever Strategist receives a new task, an unhandled alert, or is deciding whether to issue a directive."
metadata:
  version: 1.0.0
  type: always-active
---

# Priority Triage

Classify every incoming task, alert, or event into one of three buckets **before**
issuing a directive or escalating. Clear bucket assignment prevents priority inflation.

---

## The Three Buckets

### P0 — Do now. Everything else waits.

| Trigger | Example |
|---|---|
| Production outage | Agents API returning 500s, Mission Control unreachable, event bus down |
| Security incident | Credential leak, unauthorized action detected, safety gate bypass |
| Human-escalated urgent | Elon pings #yclaw-alerts with "🚨 now" or direct mention with urgency |
| Legal/compliance trigger | Outbound content flagged for securities language, DMCA notice |
| Data loss imminent | Agent writing unreviewed content to a public channel, deploy rolling back inflight |

**Rule:** Any action required to prevent or stop immediate damage. If you're not sure
whether it's truly P0, treat it as P1 until evidence of real-world impact arrives.

### P1 — Active sprint. Needs coordination within the day.

| Trigger | Example |
|---|---|
| Blocked agent task | Architect reports a task blocked >4 hours, Builder DLQ retry exhausted |
| Stale review queue | Reviewer's `reviewer:queue_stale` event fires (>5 pending or >4h old) |
| Repeated agent failure | Same task failed 2+ times today (next fail = escalate to P0) |
| Cross-agent coordination gap | Ember needs an asset Forge hasn't produced; deadline within 24h |
| Stale PR | PR on YClawAI/YClaw CI-green + unreviewed for >1 hour |

**Rule:** Max 5 P1 items active at once. If you're adding a 6th, something must be
demoted to P2 or resolved first. Too many P1s means nothing is actually P1.

### P2 — Backlog. Address during scheduled planning (weekly_directive / midweek_review).

| Trigger | Example |
|---|---|
| Optimization idea | "We could cache X", "Ember could batch posts better" |
| Audit finding (non-critical) | Prompt contains a minor inconsistency, doc says "Slack" but should say "Discord" |
| Nice-to-have feature | Adding a new agent that isn't required by org mission |
| Cost trend concern | LLM spend up 15% month-over-month but still under budget |
| Recurring minor issue | Same agent posts slightly long messages occasionally |

**Rule:** Never dispatch a directive for a P2 item mid-heartbeat. Collect them for
the next scheduled planning cycle. Acting on P2 items out-of-cycle creates noise.

---

## Decision Tree

Ask these in order. Stop at the first YES.

1. **Is production actively broken OR is immediate damage happening?** → P0
2. **Is it blocking active sprint work within today?** → P1
3. **Everything else** → P2

If unsure between P0 and P1 → default P1. (You can always re-classify upward once evidence arrives.)
If unsure between P1 and P2 → default P2. (Inflating P1 dilutes urgency.)

---

## Anti-Patterns

- **"P0 because it's annoying."** Annoying ≠ production-critical. Route to P2.
- **"P1 because I'm the one looking at it now."** Proximity ≠ priority.
- **Upgrading P2 to P1 because it's old.** Age doesn't create urgency. Close the ticket or demote.
- **Splitting one P0 into three P1s.** A P0 is a P0. Don't water it down by fracturing.
- **Using priority to escalate to Elon.** If it genuinely needs Elon, escalate via
  escalation-triage, not priority bumping.

---

## Examples from real agent orchestration

**Scenario:** Builder DLQ has 3 entries, all for the same repo, all failing CI.
- NOT P0 (no production impact — Builder isn't deploying, it's coding)
- P1 (systemic failure pattern needs Architect directive)
- Action: issue `strategist:architect_directive` with the 3 correlation IDs and ask
  for a single plan to unblock the pattern.

**Scenario:** `sentinel:alert` fires — Atlas connection dropping intermittently.
- P0 (infrastructure; production features depend on it)
- Action: escalate to Elon in #yclaw-alerts immediately with sentinel's payload;
  do NOT issue an autonomous directive (DB is external infra, out of agent scope).

**Scenario:** Ember's content score averaged 72/100 this week (down from 85).
- NOT P1 (no deadline, no block)
- P2 (collect for weekly_directive; pair with Forge output trend for context)
- Action: note in next standup_synthesis, not now.

---

## Out-of-scope for this skill

- *How* to escalate once classified as P0 — see `escalation-triage` skill.
- *What* directive to issue for a P1 item — see `directive-authoring` skill.
- Standup classification — see `standup-synthesis` skill.
