---
name: protocol-overview
description: "Authoritative technical description of YCLAW — the open-source AI agent orchestration framework. Single source of truth for framework claims, architecture, and terminology."
metadata:
  version: 2.0.0
  type: always-active
---

# YCLAW — Technical Overview

This document is the authoritative technical description of YCLAW. All agents should reference it when making claims about what YCLAW is, how it works, or what it provides. If a claim cannot be verified against this document, `CLAUDE.md`, or the running code, it should be flagged for review.

---

## What YCLAW Is

YCLAW is an **open-source AI agent orchestration framework**. It provides the infrastructure to run an organization of AI agents with real department structures, event-driven coordination, HMAC-signed event buses, persistent agent memory, and human oversight through approval gates.

YCLAW was extracted from a production system that ran 12 autonomous agents for over a year before being open-sourced. It is released under AGPL-3.0. It is built on OpenClaw and is model-agnostic — Anthropic, OpenAI, Google, OpenRouter, or any compatible LLM provider.

YCLAW is not a DeFi protocol, not a token project, not a managed service. It is infrastructure you deploy and run yourself.

---

## Core Concepts

| Concept | Definition |
|---|---|
| **Agent** | An autonomous AI worker with a specific role, model config, system prompts, and scoped actions. Defined by a YAML file in `departments/<dept>/<agent>.yaml`. |
| **Department** | A logical grouping of agents. YCLAW ships with six: Executive, Development, Marketing, Operations, Finance, Support. |
| **Event Bus** | Redis Streams-based coordination layer with HMAC-signed envelopes. Events follow the pattern `source:type` (e.g., `builder:pr_ready`, `architect:pr_review`). |
| **Approval Gate** | A checkpoint that requires human or senior-agent approval before a high-risk action executes (e.g., `deploy:execute`, `safety:modify`). |
| **Agent Memory** | Persistent per-agent key-value store backed by MongoDB. Survives across executions. |
| **Mission Control** | Next.js dashboard for monitoring agent activity, approving actions, and managing the organization. |
| **AO (Autonomous Operator)** | Code-change pipeline. Agents propose, review, and merge changes through a governed workflow. |
| **Skill** | A scoped, loadable knowledge asset. Shared skills apply to all agents; per-agent skills live under `skills/<agent>/`. |

---

## Agent Roster

YCLAW ships with 13 agents across 6 departments:

| Department | Agents |
|---|---|
| **Executive** | strategist, reviewer |
| **Development** | architect, designer, mechanic |
| **Marketing** | ember, forge, scout |
| **Operations** | sentinel, librarian |
| **Finance** | treasurer |
| **Support** | guide, keeper |

Each agent has a YAML config, a set of system prompts loaded on every run, a set of allowed actions (tools), and event subscriptions/publications.

---

## Architecture

```
+----------------------------------------------------+
|                 Mission Control                     |
|              (Next.js Dashboard)                    |
+------------------------+---------------------------+
                         |
+------------------------+---------------------------+
|                    API Server                       |
|  +----------+ +----------+ +--------------------+  |
|  | Executor | | Triggers | | Approval Manager   |  |
|  +----------+ +----------+ +--------------------+  |
|  +----------+ +----------+ +--------------------+  |
|  | Actions  | | Safety   | | Channel Notifier   |  |
|  +----------+ +----------+ +--------------------+  |
+----+---------------+----+
     |                    |
+----+------+    +-------+---+
| MongoDB   |    |   Redis   |
|  Memory   |    |  Events   |
+-----------+    +-----------+
```

### Agent Execution Flow

```
Trigger (cron | event | webhook)
    → Config Loader (YAML + prompts + memory)
    → LLM Call (with scoped tools)
    → Action Executors (github, slack, event, codegen, ...)
    → Review Gate (for external-facing content)
    → Audit Log
```

### Key Subsystems

| Subsystem | Location | Purpose |
|---|---|---|
| Agent Executor | `packages/core/src/agent/executor.ts` | Runs agent tasks with LLM + tools |
| Config Loader | `packages/core/src/config/loader.ts` | Loads YAML, prompts, memory |
| Event Bus | `packages/core/src/triggers/event.ts` | Inter-agent pub/sub |
| Review Gate | `packages/core/src/review/reviewer.ts` | Brand review for external content |
| Outbound Safety | `packages/core/src/review/outbound-safety.ts` | Content safety filter |
| Codegen | `packages/core/src/codegen/` | CLI tool orchestration |
| Builder Dispatcher | `packages/core/src/builder/dispatcher.ts` | Priority queue, worker pool, task state callbacks |
| Operator Task Queue | `packages/core/src/operators/task-queue.ts` | Operator-issued task queuing |

---

## Triggers

Agents are activated by three trigger types:

- **Cron** — scheduled executions (standups, heartbeats, weekly directives)
- **Event** — pub/sub via the event bus (e.g., `review:pending`, `github:pr_opened`)
- **Webhook** — external events (GitHub webhooks normalized into internal events)

A special `batch_event` trigger waits for N events of a given type (or a timeout) before firing — used for aggregated tasks like standup synthesis.

---

## Safety Model

YCLAW has layered safety by design:

1. **Allow-lists per agent** — every action (tool) must be declared in the agent's YAML.
2. **Approval gates** — `deploy:execute`, `safety:modify`, and other high-risk actions require explicit approval (human or senior-agent) before running.
3. **Review gate** — all external-facing content passes through the Reviewer agent (brand voice, legal compliance, terminology).
4. **Outbound safety filter** — regex/keyword checks for credential leaks, exfiltration patterns, and brand violations before content publishes.
5. **Self-modification guards** — the YCLAW repo itself is excluded from codegen (self-modification protection).

---

## Deployment

YCLAW runs on:

- **Docker Compose** (self-hosted, default)
- **AWS ECS Fargate** (production reference)
- Any container runtime that supports Node 20 LTS + MongoDB + Redis

Mission Control runs as a separate Next.js service on its own port (3001). The Agents API (Express) runs on port 3000. GitHub webhooks post to `/github/webhook`.

---

## What YCLAW Is Not

- **Not a DeFi protocol.** YCLAW is agent infrastructure, not a financial product.
- **Not a token project.** There is no YCLAW token. No tokenomics. No yield.
- **Not a managed service.** You deploy and run YCLAW yourself.
- **Not a single-model framework.** Works with any LLM provider.
- **Not a chatbot wrapper.** Agents are scoped workers with departments, events, and approvals — not prompt-chained demos.

---

## Key References

- **GitHub:** https://github.com/YClawAI/YClaw
- **Website:** https://yclaw.ai
- **License:** AGPL-3.0
- **Canonical architecture doc:** `docs/ARCHITECTURE.md`
- **Project-level rules for AI tools:** `CLAUDE.md`
- **Brand voice:** `prompts/brand-voice.md`
- **Mission statement:** `prompts/mission_statement.md`
