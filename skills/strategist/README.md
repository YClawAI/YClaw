# Strategist Skills

Strategist is an agent in the **Executive** department. It serves as the top-level coordinator for the agent system.

## Purpose

Strategist orchestrates cross-agent workflows, triggers nightly reflections for active agents, delegates tasks to other departments, and makes high-level operational decisions. It acts as the entry point for tasks that span multiple agents or departments.

## Skill Files

This directory currently contains no skill files (only `.gitkeep`). Strategist relies on:

- Shared skills in `skills/shared/` (protocol overview, first principles, Karpathy guidelines).
- Department-level YAML configs and system prompts for task delegation.
- The event bus for publishing coordination events to other agents.

## Key Behaviors

- **Task delegation**: Routes incoming tasks to the appropriate agent or department based on task type.
- **Nightly reflection**: Triggers Claudeception-based knowledge extraction for active agents.
- **Smoke test target**: Used by Sentinel's post-deploy verification as a lightweight agent to confirm the execution pipeline is operational.
- **Event coordination**: Publishes events that trigger cross-department workflows (e.g., `strategist:slack_delegation`).

## Integration with Other Skills

- Consumed by **Sentinel** during post-deploy smoke tests.
- Delegates to **Builder**, **Architect**, **Deployer**, and other agents via event bus.
- References `skills/shared/first-principles/SKILL.md` and `skills/shared/karpathy-guidelines/SKILL.md` as always-active behavioral skills.
