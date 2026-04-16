---
name: delegation-policy
description: "When and how Architect delegates tasks to AO, Mechanic, and Designer."
metadata:
  version: 1.0.0
  type: policy
---

# Delegation Policy

> Architect NEVER executes. Architect delegates. This skill defines which executor
> gets which task.

## Routing Table

| Task Type | Route To | Event | Examples |
|-----------|----------|-------|----------|
| Feature implementation | AO | `architect:build_directive` | "Add webhook retry logic", "Implement X endpoint" |
| Bug fixes requiring investigation | AO | `architect:build_directive` | "Race condition in dispatcher", "Users see stale cache" |
| Test writing (non-trivial) | AO | `architect:build_directive` | "Add integration tests for bootstrap flow" |
| Architecture changes | AO | `architect:build_directive` | "Refactor HMAC signing", "Extract shared util" |
| Frontend/UI work | Designer (via `strategist:designer_directive` routing) | See note below | New components, design tokens, Figma integration |
| Formatting / prettier fixes | Mechanic | `architect:mechanic_task` | "Run prettier on src/" |
| Lint error fixes (eslint --fix) | Mechanic | `architect:mechanic_task` | "Fix auto-fixable eslint errors" |
| Lockfile sync | Mechanic | `architect:mechanic_task` | After dependency change |
| Branch rebasing | Mechanic | `architect:mechanic_task` | "Rebase feature/x on main" |
| Dependency version bumps | Mechanic | `architect:mechanic_task` | "Bump vitest to 3.x" |
| Codegen regeneration | Mechanic | `architect:mechanic_task` | OpenAPI stubs, Prisma client |
| Any task requiring creative problem-solving | AO | `architect:build_directive` | — |
| Any task with known command + known parameters | Mechanic | `architect:mechanic_task` | — |

**Note on Designer routing:** Architect does not directly delegate to Designer. Frontend issues are labeled `UI` and picked up by Designer via Strategist or AO's `pr_ready` event. Architect only coordinates via `architect:design_directive` for cross-cutting style changes.

## Decision Test

- If a task can be completed by running a **known command with known parameters** → Mechanic.
- If a task requires **reading code, understanding context, and making decisions** → AO.
- If a task involves **visual design or frontend polish** → route via Designer's triggers, don't delegate directly.

## Task Payload Structure

### For AO (`architect:build_directive`)

Required fields:
- `repo` — full slug (`owner/repo`, e.g. `YClawAI/yclaw`)
- `issueNumber` — integer
- `investigation_summary` — what the issue is about, root cause
- `key_files` — likely paths needing changes
- `constraints` — what NOT to change, safety boundaries
- `acceptance_criteria` — how to verify success

### For Mechanic (`architect:mechanic_task`)

Required fields:
- `repo` — full slug
- `operation_type` — one of: `lockfile_sync`, `formatting`, `linting`, `rebasing`, `dependency_bump`, `codegen_regen`
- `task_description` — precise command or change description
- `acceptance_criteria` — observable outcome (e.g. "lockfile matches package.json", "eslint --fix runs with 0 errors")

## Immutable Routing Rules

1. **Never delegate AO work to Mechanic.** Mechanic cannot write feature code.
2. **Never delegate Mechanic work to AO.** Wastes context on trivial operations.
3. **Never bypass the directive pattern.** Do not call actions directly for delegated work — always publish an event.
4. **Never delegate if AO/Mechanic is degraded.** Call `ao:status` first (or check recent Mechanic health). If degraded, stop and let the issue wait.
5. **Never delegate more than 1 issue per invocation.** You're handling a single trigger event.

## See Also

- `issue-triage/SKILL.md` — labeling rules that determine eligibility
- `deployment-review/SKILL.md` — for deploy-related directives (deploys go to Strategist, not AO)
- `pipeline-health/SKILL.md` — when to halt delegation due to CI health
