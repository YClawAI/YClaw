# YClaw Technical Overview

## Architecture

YClaw is a TypeScript monorepo that orchestrates AI agents into a functioning organization. Agents are grouped into departments, communicate via an event bus, and operate within defined guardrails.

### Core Components

| Component | Purpose |
|-----------|---------|
| **Agent Runtime** | Executes agent tasks with tool access, memory, and model routing |
| **Event Bus** | Inter-agent communication — agents publish events, others subscribe and react |
| **Department Structure** | Logical grouping of agents by function (marketing, development, support, etc.) |
| **Memory System** | Per-agent MongoDB-backed memory for context persistence across executions |
| **Safety Gate** | Reviews self-modifications, content output, and cross-agent actions |
| **Notification Router** | Routes agent output to Discord, Slack, or other channels |
| **Mission Control** | Web UI for monitoring, configuration, and the AI Handshake onboarding |
| **AO (Autonomous Operator)** | Self-healing agent that monitors GitHub issues and creates fix PRs |

### Agent Lifecycle
1. **Trigger** — Cron schedule, inbound event, or manual API call
2. **Context Assembly** — System prompts, memory, department context loaded
3. **Execution** — LLM processes task with available tools (GitHub, Discord, Twitter, memory, events)
4. **Safety Check** — Output reviewed against safety gates and review rules
5. **Action** — Tools called, events published, notifications routed
6. **Memory Write** — Execution results persisted for future context

### Event-Driven Coordination
Agents don't call each other directly. They publish typed events:
- `ember:content_ready` → triggers Reviewer
- `reviewer:approved` → triggers Ember to publish
- `forge:asset_ready` → triggers Ember to attach visuals
- `strategist:ember_directive` → Ember receives strategic guidance

### Default Department Structure

| Department | Agents | Function |
|------------|--------|----------|
| **Executive** | Strategist, Reviewer | Strategy, coordination, content review |
| **Development** | Architect, Designer | Technical leadership, UI/UX |
| **Marketing** | Ember, Forge, Scout | Content creation, visual assets, competitive research |
| **Operations** | Sentinel, Librarian | Infrastructure monitoring, knowledge management |
| **Finance** | Treasurer | Budget tracking, cost monitoring |
| **Support** | Guide, Keeper | Customer support, community moderation |

### Tech Stack
- **Runtime:** Node.js / TypeScript monorepo (Turborepo)
- **Database:** MongoDB Atlas (agent memory, executions, config)
- **Cache:** Redis (rate limiting, event streams, execution cache)
- **LLM:** Model-agnostic via LiteLLM proxy or direct provider APIs
- **Deploy:** AWS ECS Fargate (Terraform), Docker Compose for local dev
- **CI/CD:** GitHub Actions — lint, test, build, deploy per-service
- **Channels:** Discord (primary), Slack, Telegram, Twitter/X

### API
- `POST /api/trigger` — Trigger an agent task
- `GET /api/agents` — List all agents and their configs
- `GET /api/executions?id=<id>` — Poll execution status
- `GET /api/health` — Service health check

### Key Configuration Files
- `departments/*/agent.yaml` — Agent definition (model, triggers, actions, prompts)
- `prompts/*.md` — System prompt files loaded by agents
- `deploy/aws/` — Terraform infrastructure
- `.env` — Environment configuration
