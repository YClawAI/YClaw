# YClaw — Technical Overview

> Authoritative technical description of what YClaw is and how it works.
> Agents reference this document when making claims about the product.
> If a claim cannot be verified against this document, it should be flagged for review.

## What We Do

YClaw is an open-source AI agent orchestration framework. It provides the infrastructure to run an organization of AI agents — with real department structures, event-driven coordination, HMAC-signed event buses, persistent agent memory, and human oversight through approval gates.

YClaw was extracted from a production system (Gaze Protocol) that ran 12 autonomous agents for over a year. The codebase has been scrubbed of all Gaze-specific content and released under AGPL-3.0.

## How It Works

### Key Concepts

| Concept | Definition |
|---------|-----------|
| Agent | An autonomous AI worker with a specific role, model config, system prompts, and available actions |
| Department | A logical grouping of agents (Executive, Marketing, Development, Operations, Finance, Support) |
| Event Bus | Redis Streams-based coordination layer with HMAC-signed events for inter-agent communication |
| Approval Gate | A checkpoint requiring human or senior-agent approval before high-risk actions execute |
| Agent Memory | Persistent per-agent key-value store in MongoDB for cross-execution context |
| Mission Control | Web dashboard for monitoring agent activity, approving actions, and managing the org |
| Onboarding (AI Handshake) | Your AI assistant deploys YClaw, then programs the agents using your org's context |
| Operator | A human or AI assistant that connects to YClaw to manage and direct the agent organization |

## Key Features

- **Department-based org structure** — Agents organized into departments with role-based access control
- **Event-driven coordination** — Redis Streams event bus with HMAC signatures for secure inter-agent communication
- **Approval gates** — Configurable human-in-the-loop checkpoints for high-risk actions
- **Persistent agent memory** — MongoDB-backed per-agent memory that survives across executions
- **Model-agnostic** — Works with Anthropic, OpenAI, Google, OpenRouter, or any compatible LLM provider
- **Self-hosted** — Docker Compose deployment, runs on your infrastructure
- **Prompt caching** — Frozen prompt snapshots with cache_control markers for massive cost savings
- **Self-modification** — Agents can update their own configs, schedules, and prompts (with safety gates)
- **Multi-operator** — Multiple AI assistants can connect to the same YClaw org simultaneously

## Target Audience

- Developers building multi-agent AI systems
- AI-forward organizations adopting agent workforces
- Open-source contributors interested in agent infrastructure

## Architecture

```
+---------------------------------------------------+
|                  Mission Control                   |
|              (Next.js Dashboard)                   |
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
+----+---------------+---------------+---------------+
     |               |               |
+----+----+    +-----+-----+   +----+----+
| MongoDB |    |   Redis   |   |Postgres |
| Memory  |    |  Events   |   | Memory  |
+---------+    +-----------+   +---------+
```

## What We Are Not

- **Not a DeFi protocol.** YClaw is agent infrastructure, not a financial product.
- **Not a token project.** There is no YClaw token. No tokenomics. No yields.
- **Not a managed service.** You deploy and run YClaw yourself.
- **Not single-model.** Works with any LLM provider.

## Key Links

- **GitHub:** https://github.com/YClawAI/YClaw
- **Website:** https://yclaw.ai
- **Discord:** https://discord.com/invite/HqFDg4UHXx
- **License:** AGPL-3.0
