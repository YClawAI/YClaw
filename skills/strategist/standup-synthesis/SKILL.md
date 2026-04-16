---
name: standup-synthesis
description: "Methodology for synthesizing per-agent standup:report events into a single cross-department summary. Use when executing the standup_synthesis task (batch_event on standup:report)."
metadata:
  version: 1.0.0
  type: task-specific
  loaded_by: [standup_synthesis]
---

# Standup Synthesis

You are synthesizing ~12 individual agent standup reports into one executive-readable
summary. The output goes to #yclaw-executive. Executives SKIM this — they do not read
it line-by-line. Write for skim, not depth.

---

## Input

A `batch` of `standup:report` events, each with a payload like:

```json
{
  "agent": "architect",
  "date": "2026-04-16",
  "shipped": ["PR #42 reviewed", "Issue #88 triaged"],
  "blocked": ["Deploy #123 awaiting Sentinel canary"],
  "next": ["Break down issue #91"],
  "metrics": { "pr_reviews": 4, "directives_handled": 2 }
}
```

Events arrive via batch_event (min_count: 8 OR 20-min timeout). Any agent that did
NOT report is a notable absence — flag them by name.

---

## Output Structure (max 500 words)

```
📋 Org Standup — YYYY-MM-DD

🎯 Headlines (3–5 bullets, most-impactful first)
• <Agent>: <what shipped — outcome, not activity>
• <Agent>: <…>

🚧 Blockers (only if real — omit section if empty)
• <Agent> → <blocker> → needs <agent or human>

📈 Trends (1–3 observations spanning multiple agents)
• <pattern observed across ≥2 agents>

🎬 Action Items (max 3)
• <specific, owned, time-boxed>

🔇 Did not report: <list any agent with active cron that didn't emit>
```

---

## Synthesis Rules

### 1. Headlines: Outcomes, not activities

- **Bad:** "Architect reviewed 4 PRs today."
- **Good:** "Architect approved the Sentinel deploy-execute migration (PR #115)."

"Activity" is a count. "Outcome" is a change in state. Executives care about change.

### 2. Don't parrot

If three agents all reported the same thing (e.g., "supported the OS launch"), collapse
into ONE headline mentioning all three. Never list the same event three times.

### 3. Flag conflicts

If agent A says "waiting on B" and agent B says nothing about it, that's a coordination
gap. Call it out in Blockers. This is the single highest-value thing synthesis catches.

### 4. Flag non-reporters

If Architect's daily standup cron fires at 13:30 but no `standup:report` from
Architect made it into the batch, the synthesis output includes `Did not report:
architect`. Don't let silent agents disappear.

### 5. No editorializing

- **Bad:** "Great work from Ember this week!"
- **Good:** "Ember published 12 posts (weekly avg: 8)."

Executives read the numbers and decide themselves. Cheerleading dilutes signal.

### 6. Trends over individual reports

The "Trends" section is where synthesis earns its keep. Look for:
- Multiple agents hitting the same external system (all waiting on Atlas?)
- Repeated blockers from the same agent (Sentinel blocked 3 days in a row?)
- Cost or queue-depth patterns across the day
- Cross-department coordination gaps (Forge output not matching Ember demand)

### 7. Action items must be specific

Each action item names an owner, a concrete step, and a deadline:
- ❌ "Look into the PR backlog."
- ✅ "Architect: issue sweep directive to clear PRs older than 4h before EOD."

---

## Length Discipline

Hard cap: 500 words. If you're over, cut.

Priority for cuts:
1. Trends section (keep the single most-important trend)
2. Headlines (keep 3 instead of 5)
3. Metrics inside headlines (keep 1 per agent max)

Never cut: Blockers (these are the ones that NEED human attention) or the
"Did not report" list.

---

## Timing / Posting

1. Compose synthesis
2. Post to #yclaw-executive via `discord:message`
3. `event:publish` a `strategist:standup_synthesis` event with the synthesis text
   (downstream: other agents/dashboards consume this)

If the synthesis is empty because only 1 agent reported → don't post. A one-agent
"synthesis" is noise. Escalate via `sentinel:alert` that the org is silent.

---

## Anti-Patterns

- **Repeating the event bus.** Don't list every single agent event — summarize.
- **Padding with "all quiet" sections.** If Trends section is empty, omit it entirely.
- **Using past synthesis as a template.** Re-derive from THIS batch every time.
- **Numeric precision without context.** "Builder closed 7 PRs" — ok. "Builder
  closed 7 PRs (avg 4)" — better. "Builder closed 7 PRs (avg 4); this is the
  highest day of the month" — best.
- **Skipping the "Did not report" list when all agents reported.** Replace with
  "All 12 agents reported ✓" so readers know you checked.

---

## Out of scope

- What to DO about a flagged blocker → see `directive-authoring` skill.
- Whether a blocker is P0 or P1 → see `priority-triage` skill.
- Whether to escalate a trend to Elon → see `escalation-triage` skill.
