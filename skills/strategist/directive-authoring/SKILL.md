---
name: directive-authoring
description: "Templates and patterns for writing agent directives. Use whenever Strategist is about to emit a strategist:*_directive event. A directive that lacks success criteria, deadline, or clear objective wastes agent cycles."
metadata:
  version: 1.0.0
  type: always-active
---

# Directive Authoring

A directive is how Strategist issues work to another agent. It arrives in the target
agent's event bus as a structured payload. The target agent reads it and decides what
to do. If your directive is vague, the agent will either guess (often wrong) or ping
back asking for clarification (wasting tokens).

---

## Required Structure

Every directive payload MUST have these five fields:

```json
{
  "context": "<1-3 sentences — why this is happening now>",
  "objective": "<single-sentence goal — what success looks like>",
  "constraints": ["<hard limits: time, scope, cost, permissions>"],
  "success_criteria": ["<observable checks — how the agent knows it's done>"],
  "deadline": "<ISO timestamp OR 'EOD' OR 'before <event>'>"
}
```

Optional but encouraged:
- `priority`: "P0" | "P1" | "P2" (see `priority-triage` skill)
- `objectiveId`: link to an existing Objective for cost tracking
- `parentTaskId`: if this is a sub-task of something already in flight
- `causalChain`: `["event:...", "alert:..."]` for traceability

---

## Per-Department Directive Events

| Department | Event Name | Typical Payload Additions |
|---|---|---|
| Development | `strategist:architect_directive` | `repo`, `issue_number` if applicable |
| Marketing | `strategist:ember_directive`, `strategist:forge_directive`, `strategist:scout_directive` | `content_type`, `target_platform` |
| Operations | `strategist:sentinel_directive` | `scope` (deploy, quality, health) |
| Finance | `strategist:treasurer_directive` | `budget_refs` |
| Support | `strategist:guide_directive`, `strategist:keeper_directive` | `case_id` if user-originated |
| Executive | `strategist:reviewer_directive` | `content_ref` |

See `strategist-workflow.md` §Directive Routing for the canonical list and routing rules.
Use Architect as the dev-department entry point — never bypass.

---

## Good vs Bad Examples

### ❌ Bad — vague, unactionable

```json
{
  "context": "Things are slow",
  "objective": "Improve performance",
  "constraints": [],
  "success_criteria": ["Make it faster"],
  "deadline": "Soon"
}
```

Why it fails:
- "Things" = what exactly?
- "Improve" = from what to what?
- No hard limits = the agent will scope-creep.
- "Make it faster" = the agent can't verify done.
- "Soon" = not actionable.

### ✅ Good — specific, measurable

```json
{
  "context": "Strategist heartbeat is averaging 12s per run (target: under 6s). A recent prompt addition pushed total tokens from 13K to 19K per run. Cost up 40% week-over-week.",
  "objective": "Reduce Strategist heartbeat latency to under 6s p95 without losing functional coverage.",
  "constraints": [
    "No additional LLM provider dependencies",
    "Must preserve all current threshold checks",
    "Max 1 PR, under 200 lines changed"
  ],
  "success_criteria": [
    "p95 heartbeat latency < 6000ms over 24h (CloudWatch Metric)",
    "All existing config-validation tests pass",
    "No new CUSTOMIZE placeholders introduced"
  ],
  "deadline": "2026-04-18 EOD UTC",
  "priority": "P1",
  "causalChain": ["sentinel:alert:strategist_heartbeat_slow"]
}
```

---

## Anti-Patterns

- **"Fix the thing."** If you can't describe the thing in one sentence, stop. Go back to `priority-triage`.
- **Success criteria = "works."** Use observable checks (a test passes, a metric improves, a file exists).
- **Deadline = "ASAP."** Use an ISO timestamp or a named event boundary.
- **Constraints = "best effort."** Every constraint-free directive gets over-scoped.
- **Dispatching a directive when you could just query.** `task:query` + a comment costs
  less than a full directive if the answer is just "do X, not Y."
- **Multi-department directives.** If the work spans departments, issue one directive
  per department and coordinate the handoff via events (not one mega-directive).

---

## Cross-Department Coordination Format

When coordination is genuinely cross-cutting (e.g., Ember needs Forge to produce an
asset before posting), issue TWO directives in sequence, each self-contained:

```
strategist:forge_directive → asset creation (short deadline)
  emits forge:asset_ready
strategist:ember_directive → post with asset (triggered by forge:asset_ready)
```

Not one big directive to both. The event wiring IS the coordination protocol.

---

## Verification Before You Emit

Before calling `event:publish` with a directive, verify:

- [ ] All five required fields present and non-empty
- [ ] The target department's event name is correct (cross-check `strategist-workflow.md`)
- [ ] Success criteria are *observable* (measurable, testable, or existence-checkable)
- [ ] Deadline is a real time, not "soon" / "ASAP"
- [ ] You're not dispatching a P2 item (those wait for weekly_directive)
- [ ] If critical, you've tagged `priority: "P0"` so the target agent skips its queue

---

## Out of scope

- Deciding *whether* to issue a directive vs handle autonomously — see `escalation-triage` skill.
- Determining *priority* — see `priority-triage` skill.
- *What* events the target agent publishes in response — see its workflow prompt.
