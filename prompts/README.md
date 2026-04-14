# prompts/

System prompt templates and workflow definitions loaded by the agent runtime. Each agent receives one or more of these files as part of its LLM context on every execution.

These files are **convention-protected** -- Architect review and the DoD gate catch unauthorized changes at merge time. Coding agents must not modify them during automated retry.

---

## File Categories

### Agent Workflows

Step-by-step task sequences loaded by specific agents. Each defines the exact tool calls, event payloads, and decision logic for every task type the agent handles.

| File | Agent | Purpose |
|------|-------|---------|
| `architect-workflow.md` | Architect | PR review (ack, full review, fast-pass), deploy review (5-point rubric), weekly tech debt scan, plan review |
| `designer-workflow.md` | Designer | Design system compliance review for frontend PRs, Figma token comparison, accessibility audit, design directives |
| `reviewer-workflow.md` | Reviewer | Brand voice review, legal compliance check, quality scoring (0-100), content routing (approve/flag/block) |
| `strategist-workflow.md` | Strategist | Daily standup synthesis, weekly directive setting, midweek review, monthly strategy. Includes directive routing patterns for all 12 agents |
| `strategist-heartbeat.md` | Strategist | 30-minute heartbeat protocol -- stuck task detection, PR triage, unblocking, anti-spam rules, escalation criteria |
| `sentinel-quality-workflow.md` | Sentinel | Bi-weekly code quality audit across all repos -- CLAUDE.md staleness, broken imports, dead exports, security scan |

### Organizational

Documents loaded by all agents or multiple departments.

| File | Loaded By | Purpose |
|------|-----------|---------|
| `mission_statement.md` | All agents | Foundational identity template -- why your organization exists, who it serves, core beliefs. Overrides all other documents on conflict |
| `chain-of-command.md` | All agents | Authority hierarchy ([Executive] -> [AI Chief of Staff] -> Strategist -> Agents), escalation protocol, cross-agent collaboration rules |
| `executive-directive.md` | Executive agents | Business objectives, KPIs, weekly priorities, department status, risk tolerance, operating rules |
| `engineering-standards.md` | Architect | Code quality limits (100-line functions, complexity 8), TypeScript strict mode, review order, deployment assessment checklist |
| `data-integrity.md` | All agents | Prohibits fabricated metrics -- agents must report "DATA UNAVAILABLE" with the specific integration needed |

### Daily Operations

| File | Purpose |
|------|---------|
| `daily-standup.md` | Base standup protocol for all agents -- scan format, blocker verification rules, anti-patterns |
| `daily-standup-dev.md` | Development department extension -- PR/deploy/review-specific reporting, per-agent rules |
| `strategist-objectives.md` | Objective lifecycle management -- creation, KPIs, cost tracking, auto-pause triggers |
| `model-review.md` | Monthly LLM model evaluation task -- usage data collection, per-task override recommendations, cost optimization |

### Brand & Content

| File | Purpose |
|------|---------|
| `brand-voice.md` | Brand identity template -- voice attributes, tone spectrum by channel, terminology dictionary, style rules, visual identity, copy templates, legal compliance notes. See `examples/templates/` for a comprehensive real-world example |
| `content-templates.md` | Content template library for content agents — announcement, educational, community engagement, metrics templates with `{{variable}}` placeholders. See `examples/templates/` for 18 production templates |
| `review-rules.md` | Review queue rulebook -- routing logic (AUTO/TIMED/REVIEW/BLOCKED) per agent, confidence scoring methodology, override commands, forbidden content list, escalation chains |
| `review-submission.md` | Protocol for submitting content to the review pipeline via `event:publish` with `review:pending` |
| `keeper-telegram-safety.md` | Pre-launch lockdown rules for Keeper -- no proactive Telegram posts, no protocol details, reactive moderation only |

### Design System

| File | Purpose |
|------|---------|
| `design-system.md` | Design token template — CSS custom properties, typography scale, component tokens, responsive breakpoints. See `examples/templates/` for a comprehensive example with Tailwind config and SVG logos |
| `component-specs.md` | Component behavior specifications — shared patterns (hover, loading, transitions), navigation, data cards, charts, action panels, ranked tables, form inputs, modals |

### Learning & Skills

| File | Purpose |
|------|---------|
| `claudeception.md` | Continuous learning protocol -- when to extract skills, quality criteria, per-agent skill storage structure, extraction process (check/identify/structure/save/record), retrospective mode, anti-patterns |
| `skill-usage.md` | Skill lookup protocol -- check personal skills and shared skills before non-trivial tasks, directory structure, lane isolation rules |

### Protocol Reference

| File | Purpose |
|------|---------|
| `protocol-overview.md` | Organization overview template — technical description of your product/service, key concepts, features, target audience, architecture, API endpoints. See `examples/templates/` for a comprehensive real-world example |

---

## How Files Are Loaded

The config loader (`packages/core/src/config/loader.ts`) reads each agent's YAML config in `departments/` and resolves the `prompts` field to files in this directory. Files are concatenated into the agent's system prompt before every LLM call.

Most agents load 3-6 prompt files. For example, Architect loads: `mission_statement.md`, `chain-of-command.md`, `engineering-standards.md`, `claudeception.md`, and `skill-usage.md`.

## Naming Convention

- Workflow files: `{agent}-workflow.md` or `{agent}-{task}.md`
- Shared documents: descriptive kebab-case (e.g., `engineering-standards.md`)
- All files are Markdown with no frontmatter (unlike vault notes)

## Adding a New Prompt

1. Create the `.md` file in this directory.
2. Reference it in the agent's YAML config under `prompts:`.
3. Submit a PR -- changes to `prompts/*.md` require Architect review.
