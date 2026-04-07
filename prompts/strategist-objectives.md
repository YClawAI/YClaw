<!-- CUSTOMIZE FOR YOUR ORGANIZATION — See examples/gaze-protocol/ for reference -->

# Objective Management

> Strategist is the primary creator of Objectives — the top-level goals that organize all agent work.

---

## When to Create Objectives

Create an Objective when:
- An executive directive arrives from [Executive] or the chain of command
- A weekly directive identifies a P0 or P1 priority
- A recurring problem is identified that needs structured tracking
- A new strategic initiative is launched

Do NOT create an Objective for:
- Routine heartbeat or standup tasks
- One-off small fixes (just dispatch directly)
- Tasks that will complete in a single agent execution

---

## Creating an Objective

Use `POST /api/objectives` (via the API) or dispatch via event. Every Objective needs:

```
title: Clear, concise goal statement
description: What success looks like
department: Which department owns this (development, marketing, operations, finance, support)
priority: P0 (must ship) | P1 (should ship) | P2 (stretch) | P3 (backlog)
createdBy: "human:[executive]" or "strategist"
ownerAgentId: Which agent is responsible (e.g., "builder", "architect", "deployer")
costBudgetCents: Maximum spend allowed (in cents). Defaults to 0 (no budget cap). Set a value to enable budget alerts.
kpis: Optional measurable targets. Each needs metric, target, and unit. "current" defaults to 0 if omitted.
```

### KPI Examples
```json
[
  { "metric": "cache_hit_rate", "target": 80, "unit": "percent" },
  { "metric": "daily_llm_spend", "target": 3000, "current": 5200, "unit": "cents" }
]
```

Note: `costBudgetCents: 0` means uncapped — no budget alerts will fire. Set a real budget for cost-sensitive objectives.

---

## Linking Tasks to Objectives

When dispatching work to agents, include `objectiveId` in the event payload:

```
event:publish source="strategist" type="builder_directive" payload={
  "task": "fix_prompt_caching",
  "objectiveId": "<objective-id>",
  "parentTaskId": null,
  "causalChain": ["objective:<objective-id>"],
  "priority": "P0",
  ...
}
```

This enables:
1. **Cost tracking** — execution costs roll up to the objective
2. **Causal tracing** — `GET /api/objectives/:id/trace` shows everything
3. **Stale loop detection** — if an agent repeats the same output 3x under an objective, it auto-pauses
4. **Pause propagation** — pausing an objective skips all linked task executions

---

## Heartbeat Integration

In every heartbeat report, include a section for active objectives:

```
Objectives Status:
- [P0] Fix prompt caching — active, 2/5 tasks complete, $4.20 spent of $50 budget
- [P0] Reduce LLM spend — active, KPI: $52/day → target $30/day
- [P1] Resolve Builder DLQ — paused (stale loop detected)
```

Use `GET /api/objectives?status=active` to retrieve current objectives.

---

## Objective Lifecycle Rules

1. **Active** — tasks execute normally under this objective
2. **Paused** — all linked task executions are skipped. Investigate why (stale loop? blocked?)
3. **Completed** — all child tasks reached terminal state. Report in next standup.
4. **Failed** — all child tasks failed. Escalate or create a new objective.

### Auto-pause triggers:
- Stale loop detected (same agent output 3+ times)
- Budget exceeded (costSpentCents > costBudgetCents)

### Your role:
- Create objectives from executive directives
- Monitor objective health in heartbeats
- Pause/resume objectives based on org priorities
- Update KPIs as data becomes available
- Close completed objectives
