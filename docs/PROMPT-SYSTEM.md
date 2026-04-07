# YClaw Agents Prompt System

This document describes the prompt files that currently exist in `prompts/` and the prompt sets referenced by the live agent configs in `departments/`.

## How Prompt Loading Works

Each agent YAML file uses a `system_prompts` array:

```yaml
system_prompts:
  - mission_statement.md
  - chain-of-command.md
  - daily-standup.md
```

The runtime resolves these files from `prompts/` in YAML order and concatenates them into the system context before execution.

## Current Inventory

The repository currently contains 26 prompt files in `prompts/`.

### Shared foundation

Referenced by all 12 agents:

- `claudeception.md`
- `skill-usage.md`
- `mission_statement.md`
- `chain-of-command.md`

### Daily operations and planning

- `daily-standup.md`
- `daily-standup-dev.md`
- `model-review.md`
- `strategist-heartbeat.md`
- `strategist-objectives.md`

### Workflow prompts

- `architect-workflow.md`
- `designer-workflow.md`
- `reviewer-workflow.md`
- `sentinel-quality-workflow.md`
- `strategist-workflow.md`

### Review, policy, and domain prompts

- `brand-voice.md`
- `component-specs.md`
- `content-templates.md`
- `data-integrity.md`
- `design-system.md`
- `engineering-standards.md`
- `executive-directive.md`
- `keeper-telegram-safety.md`
- `protocol-overview.md`
- `review-rules.md`
- `review-submission.md`

### Present in the repo but not currently referenced by any `system_prompts`

- `moderation-rules.md`

## Prompt Usage by File

| Prompt | Loaded By |
|--------|-----------|
| `architect-workflow.md` | `architect` |
| `brand-voice.md` | `ember`, `reviewer` |
| `chain-of-command.md` | all agents |
| `claudeception.md` | all agents |
| `component-specs.md` | `forge` |
| `content-templates.md` | `ember` |
| `daily-standup-dev.md` | `architect`, `builder`, `deployer`, `designer` |
| `daily-standup.md` | `ember`, `forge`, `reviewer`, `scout`, `sentinel`, `strategist`, `treasurer` |
| `data-integrity.md` | `guide`, `keeper` |
| `design-system.md` | `forge` |
| `designer-workflow.md` | `designer` |
| `engineering-standards.md` | `architect`, `builder`, `deployer`, `designer` |
| `executive-directive.md` | `reviewer`, `strategist` |
| `keeper-telegram-safety.md` | `keeper` |
| `mission_statement.md` | all agents |
| `model-review.md` | `strategist` |
| `protocol-overview.md` | `guide`, `reviewer`, `sentinel`, `strategist` |
| `review-rules.md` | `reviewer` |
| `review-submission.md` | `ember`, `scout` |
| `reviewer-workflow.md` | `reviewer` |
| `sentinel-quality-workflow.md` | `sentinel` |
| `skill-usage.md` | all agents |
| `strategist-heartbeat.md` | `strategist` |
| `strategist-objectives.md` | `strategist` |
| `strategist-workflow.md` | `strategist` |

## Current Agent Prompt Sets

| Agent | Prompt Files |
|-------|--------------|
| `architect` | `claudeception.md`, `skill-usage.md`, `mission_statement.md`, `chain-of-command.md`, `daily-standup-dev.md`, `engineering-standards.md`, `architect-workflow.md` |
| `designer` | `claudeception.md`, `skill-usage.md`, `mission_statement.md`, `chain-of-command.md`, `daily-standup-dev.md`, `engineering-standards.md`, `designer-workflow.md` |
| `reviewer` | `claudeception.md`, `skill-usage.md`, `mission_statement.md`, `chain-of-command.md`, `daily-standup.md`, `executive-directive.md`, `brand-voice.md`, `review-rules.md`, `reviewer-workflow.md`, `protocol-overview.md` |
| `strategist` | `claudeception.md`, `skill-usage.md`, `mission_statement.md`, `chain-of-command.md`, `daily-standup.md`, `executive-directive.md`, `protocol-overview.md`, `model-review.md`, `strategist-workflow.md`, `strategist-heartbeat.md`, `strategist-objectives.md` |
| `treasurer` | `claudeception.md`, `skill-usage.md`, `mission_statement.md`, `chain-of-command.md`, `daily-standup.md` |
| `ember` | `claudeception.md`, `skill-usage.md`, `mission_statement.md`, `chain-of-command.md`, `daily-standup.md`, `brand-voice.md`, `review-submission.md`, `content-templates.md` |
| `forge` | `claudeception.md`, `skill-usage.md`, `mission_statement.md`, `chain-of-command.md`, `daily-standup.md`, `design-system.md`, `component-specs.md` |
| `scout` | `claudeception.md`, `skill-usage.md`, `mission_statement.md`, `chain-of-command.md`, `daily-standup.md`, `review-submission.md` |
| `sentinel` | `claudeception.md`, `skill-usage.md`, `mission_statement.md`, `chain-of-command.md`, `daily-standup.md`, `protocol-overview.md`, `sentinel-quality-workflow.md` |
| `guide` | `claudeception.md`, `skill-usage.md`, `mission_statement.md`, `chain-of-command.md`, `protocol-overview.md`, `data-integrity.md` |
| `keeper` | `claudeception.md`, `skill-usage.md`, `mission_statement.md`, `chain-of-command.md`, `keeper-telegram-safety.md`, `data-integrity.md` |

## Operational Notes

- Prompt order matters because the runtime preserves the YAML sequence.
- `prompts/README.md` is documentation only and is not loaded as a system prompt.
- Skills under `skills/` are separate from prompt loading and are not resolved through `system_prompts`.

## Updating This Surface

1. Add or edit the Markdown file in `prompts/`.
2. Update the target agent's `system_prompts` array if the file should load automatically.
3. Keep this document and `prompts/README.md` aligned with the current prompt inventory and YAML usage.
