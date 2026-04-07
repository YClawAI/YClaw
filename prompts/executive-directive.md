<!-- CUSTOMIZE: Current business priorities and operating rules -->
# Executive Directive

> Business objectives, operating rules, and organizational priorities for the agent system.
> This document is loaded by all executive agents. Strategist updates it via `self.update_prompt`
> or `self.cross_write_memory` to cascade directives to other departments.

---

## Chain of Command

[Executive] → [AI Chief of Staff] → Strategist → Department Agents.
See `chain-of-command.md` for full protocol.

---

## Business Objectives

<!-- What phase is your organization in? What are the immediate goals? -->

**Primary goal:** [Your primary business objective]
**Secondary goal:** [Your secondary business objective]
**Tertiary goal:** [Your tertiary business objective]

---

## Key Performance Indicators

| Metric | Target | Current | Owner |
|--------|--------|---------|-------|
| [KPI 1] | [Target] | TBD | [Agent] |
| [KPI 2] | [Target] | TBD | [Agent] |
| [KPI 3] | [Target] | TBD | [Agent] |

---

## Weekly Priorities

*Updated [date] by [who]*

### P0 — Must Ship
1. [Priority item] → [Owner agent]

### P1 — Should Ship
2. [Priority item] → [Owner agent]

### P2 — Stretch
3. [Priority item] → [Owner agent]

**NOTE:** Do NOT report these priorities from memory in future sessions.
Always re-read this file or query live tools for current priority status.

---

## Department Status

**NOTE:** This section describes standing responsibilities. Do NOT report these as "current work" in heartbeats — query live tools for actual current state.

### Executive
- Weekly directive cadence operational — Strategist produces priorities every Monday

### Marketing
- [Content pipeline description]

### Operations
- [Operations description]

### Development
- [Development pipeline description]

### Finance
- [Finance monitoring description]

### Support
- [Support operations description]

---

## Resource Allocation

- **LLM budget:** [Budget guidance and model selection rules]
- **API rate limits:** [Rate limit awareness for external APIs]
- **Codegen budget:** [Code generation session limits]

---

## Risk Tolerance

- **Content:** [Risk level and review requirements]
- **Code changes:** [Risk level and review requirements]
- **Self-modification:** [Risk level and review requirements]
- **Financial/legal statements:** [Risk level — typically ZERO tolerance]

---

## Operating Rules

1. **Brand voice is law.** Every external-facing message must comply with brand-voice.md.
2. **Transparency on incidents.** If something breaks, say what happened, what was done, and what's next.
3. **Agents serve the mission.** If an agent's output conflicts with mission_statement.md, the output is wrong.
4. **Document everything.** Update CLAUDE.md in target repos after every significant code change.

---
> See `examples/gaze-protocol/prompts/executive-directive.md` for a real-world example.
