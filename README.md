# 🦞 YCLAW

<p align="center">
  <strong>Your AI assistant just got a company to run.</strong>
</p>

<p align="center">
  <a href="https://openclaw.ai"><img src="https://img.shields.io/badge/Built%20on-OpenClaw-blue?style=for-the-badge" alt="Built on OpenClaw"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/License-AGPL--3.0-blue.svg?style=for-the-badge" alt="License"></a>
  <a href="https://clawhub.com"><img src="https://img.shields.io/badge/Skills-ClawHub-orange?style=for-the-badge" alt="ClawHub"></a>
  <a href="https://yclaw.ai"><img src="https://img.shields.io/badge/Web-yclaw.ai-purple?style=for-the-badge" alt="Website"></a>
  <a href="https://x.com/YClaw_ai"><img src="https://img.shields.io/badge/𝕏-@YClaw%5Fai-black?style=for-the-badge" alt="Twitter"></a>
  <a href="https://discord.gg/97Fvue9327"><img src="https://img.shields.io/badge/Discord-Join-5865F2?style=for-the-badge&logo=discord&logoColor=white" alt="Discord"></a>
</p>
<p align="center">
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/Node.js-20%2B-339933?style=for-the-badge&logo=node.js&logoColor=white" alt="Node.js"></a>
  <a href="https://www.typescriptlang.org"><img src="https://img.shields.io/badge/TypeScript-Strict-3178C6?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript"></a>
  <a href="https://www.docker.com"><img src="https://img.shields.io/badge/Docker-Ready-2496ED?style=for-the-badge&logo=docker&logoColor=white" alt="Docker"></a>
</p>

> **Open-source AI agent orchestration framework.**
> Your AI assistant deploys it. Your AI assistant programs it. Your org gets a workforce.

---

## What YCLAW Is

YCLAW is an open-source framework for running an organization of AI agents. Your existing AI assistant deploys YCLAW into your environment, then programs the agents using your organization's context (mission, brand voice, chain of command, priorities). Agents are organized into **departments** with role-based access control, an HMAC-signed event bus, and persistent agent memory. YCLAW was extracted from a production system that ran 12 autonomous agents for over a year.

---

## 💡 Your AI + Their AI + One Organization

Everyone has a personal AI assistant now. But yours can't talk to theirs, and neither can actually *run* anything together.

YCLAW is the shared operating layer. You decide the structure — departments, permissions, chain of command, treasury access — and configure how your AI works alongside your cofounder's, your team's, or your contractors'. Every action is logged: which AI did what, on behalf of which human.

Agent frameworks let one developer orchestrate their own pipelines. YCLAW lets **multiple people, with their own AI assistants, co-operate a single organization** — configured however you want it to work.

---

## Customize Your Organization

YCLAW ships with 12 agent roles. To make them yours, edit these 8 driver documents:

| File | What It Defines | Example |
|------|----------------|--------|
| `prompts/mission_statement.md` | Why your org exists | Company mission, nonprofit charter, campaign platform |
| `prompts/brand-voice.md` | How you sound | Tone, personality, language rules |
| `prompts/chain-of-command.md` | Who's in charge | Authority structure, escalation rules |
| `prompts/executive-directive.md` | Current priorities | Weekly goals, KPIs, operating rules |
| `prompts/protocol-overview.md` | What you do | Product description, service overview |
| `prompts/content-templates.md` | Content formats | Social media templates, posting schedule |
| `prompts/design-system.md` | Visual identity | Colors, typography, component specs |
| `prompts/review-rules.md` | Quality gates | What gets auto-published vs needs review |

Edit a file. Push. Your AI org restructures itself. No redeployment. No config hell.

---

## The Organization

```
                         ┌──────────────┐
                         │  EXECUTIVE   │
                         │              │
                         │  Strategist  │  Sets priorities, synthesizes reports
                         │  Reviewer    │  Brand gate, quality control
                         └──────┬───────┘
                                │
        ┌───────────────┬───────┼───────┬───────────────┬──────────────┐
        │               │               │               │              │
 ┌──────┴───────┐ ┌─────┴──────┐ ┌──────┴──────┐ ┌─────┴─────┐ ┌─────┴─────┐
 │  MARKETING   │ │ OPERATIONS │ │ DEVELOPMENT │ │  FINANCE  │ │  SUPPORT  │
 │              │ │            │ │             │ │           │ │           │
 │  Ember       │ │  Sentinel  │ │  Architect  │ │ Treasurer │ │  Guide    │
 │  Forge       │ │  Librarian │ │  Designer   │ │           │ │  Keeper   │
 │  Scout       │ │            │ │             │ │           │ │           │
 └──────────────┘ └────────────┘ └─────────────┘ └───────────┘ └───────────┘
```

Each agent is defined by a YAML config — model, temperature, system prompts, triggers, actions, and event subscriptions. Add a YAML file, add an agent.

---

## What Makes This Different

| | Agent Frameworks (CrewAI, LangGraph, AutoGPT) | YCLAW |
|---|---|---|
| **What you get** | Agent tasks / chains | A full organization with departments |
| **Configuration** | Python classes, JSON configs | 8 markdown files a human can read |
| **Interface** | Your code calls the agent | Your AI assistant IS the operator |
| **Treasury** | Not included | Multi-chain — Solana, ETH, L2s, TradFi |
| **Governance** | Basic or none | 4-tier RBAC, HMAC-signed events, audit trails |
| **Track record** | Mostly demos and prototypes | 12 agents, 1+ year, production |

YCLAW is not an agent framework. It's closer to an operating system for an autonomous company.

---

## Key Features

- **AI-operated** — Your [OpenClaw](https://openclaw.ai) assistant docks in as root operator. The assistant is the interface — it manages the fleet, not you. (More AI assistants coming soon — see roadmap.)
- **Multi-chain treasury** — Track wallets across Solana, Ethereum, L2s, and traditional finance from one operating model.
- **Self-aware agents** — Every agent knows its own config, source code, execution history, and the full org chart. They reason about their own software.
- **Autonomous pipeline** — Issues get assigned → code gets written → PRs get reviewed → CI passes → code ships. No human in the loop (unless you want one).
- **Event-driven coordination** — HMAC-signed Redis event bus. Strategist sends directives, Architect coordinates code changes, Reviewer gates content, Sentinel monitors deploys.
- **Continuous learning** — Agents extract reusable skills from every non-trivial task. The org gets smarter over time (Claudeception system).
- **Safety floors** — Immutable safety gates, protected config keys, brand review, outbound security scanning, full audit trails. Agents can evolve, but they can't override their guardrails.
- **Conversational onboarding** — Guided setup generates org profile, department configs, and brand voice from your answers. Drop files, link repos, paste URLs.
- **Built-in observability** — Health checks, 17 structured error codes, audit timeline, operator activity tracking.

---

## The AI Handshake

Every other agent framework asks **you** to write the agents.

YCLAW asks your **AI assistant** to write them.

Your AI already knows your business — it's been in your terminal, your codebase, your Slack DMs. YCLAW just needs it to write that knowledge down. Hand your assistant this repo, and it will:

1. Read `prompts/` to understand what an org-config file looks like
2. Interview you about your mission, your team, your product
3. Generate the eight markdown files that define *your* org
4. Bring up the stack with `docker compose up`
5. Watch the agents work and tune their configs

See [`AI-HANDSHAKE.md`](./AI-HANDSHAKE.md) for the full flow your assistant should follow.

---

## Quick Start

```bash
git clone https://github.com/YClawAI/yclaw.git
cd yclaw
cp .env.example .env
# Edit .env — add ANTHROPIC_API_KEY (or OPENAI_API_KEY)
docker compose up -d --build
```

> **First boot takes 2-3 minutes** while Docker builds the API and dashboard
> images and the migrate one-shot runs against postgres. Watch progress with
> `docker compose logs -f api`. Subsequent runs can drop the `--build` flag.

### Verify

```bash
# All five services should be "Up" or "healthy"
docker compose ps

# Should print: {"status":"ok"}
curl -fsS http://localhost:3000/health

# One-shot DB migration (idempotent — also runs automatically via the
# `migrate` service on first boot)
curl -fsS -X POST http://localhost:3000/api/migrate
```

Then open Mission Control at **http://localhost:3001**.

### First login

On first boot, the API auto-seeds a root operator and prints its API key to
stdout (NOT to log files). Find it with:

```bash
docker compose logs api | grep -A 2 'ROOT OPERATOR API KEY'
```

Copy the `gzop_live_…` key. At the Mission Control login page, authenticate
as the root operator using that key. The key is shown only once — store it
in a password manager.

> **Alternative**: set `ROOT_API_KEY=gzop_live_…` (your own pre-generated
> key) or `YCLAW_SETUP_TOKEN=<32+ char token>` in `.env` before first boot
> to skip auto-seeding and bootstrap via `POST /v1/operators/bootstrap`
> instead. See [`docs/operators.md`](docs/operators.md).

### What "working" looks like

| Check | Expected |
|-------|----------|
| `docker compose ps` | `mongo`, `redis`, `postgres`, `api`, `dashboard` all healthy |
| `curl http://localhost:3000/health` | `200 OK`, JSON body |
| `curl http://localhost:3000/health/ready` | `200 OK`, all dependencies green |
| Mission Control (`http://localhost:3001`) | Dashboard renders, no console errors |
| `docker compose logs api` | `Webhook server: http://localhost:3000`, no stack traces |

---

## Architecture Overview

### Monorepo layout

| Path | Purpose |
|------|---------|
| `packages/core` | Runtime engine — agents, operators, events, safety guards |
| `packages/memory` | PostgreSQL-backed agent memory (`@yclaw/memory`) |
| `packages/mission-control` | Next.js 14 dashboard (port 3001) |
| `packages/cli` | `yclaw` CLI — `init`, `doctor`, `deploy`, `status` |
| `departments/` | Per-department YAML agent configs |
| `prompts/` | Example markdown driver files (mission, brand voice, etc.) |
| `deploy/` | Docker Compose and AWS deploy scaffolding |
| `docs/` | Architecture, configuration, security, deployment guides |

### Service topology

```
  ┌──────────────────────────────────────────────────────────────┐
  │                      Mission Control                         │
  │                  (Next.js — port 3001)                       │
  └──────────────────────┬───────────────────────────────────────┘
                         │ HTTP
  ┌──────────────────────┴───────────────────────────────────────┐
  │                       Core Runtime                           │
  │  Operators · Onboarding · Agents · Observability · Safety    │
  │              Review Gate · Codegen · Reactions               │
  └──────┬──────────────┬───────────────┬───────────────┬───────┘
         │              │               │               │
  ┌──────┴──────┐ ┌─────┴─────┐ ┌──────┴──────┐ ┌─────┴──────┐
  │  MongoDB    │ │   Redis   │ │ PostgreSQL  │ │  Channels  │
  │ State/Audit │ │Events/Bus │ │   Memory    │ │Slack/Disc. │
  └─────────────┘ └───────────┘ └─────────────┘ │Telegram/X  │
                                                 └────────────┘
```

### Department / agent model

| Department | Agents | What they do |
|-----------|--------|-------------|
| **Executive** | Strategist, Reviewer | Set priorities, synthesize standups, gate external content |
| **Development** | Architect, Designer | Review PRs, enforce design systems, coordinate codegen |
| **Marketing** | Ember, Forge, Scout | Author content, generate images/video, monitor competitors |
| **Operations** | Sentinel, Librarian | Deploy health checks, code-quality audits, knowledge curation |
| **Finance** | Treasurer | Multi-chain treasury, LLM spend tracking, financial reporting |
| **Support** | Guide, Keeper | Community moderation, escalated support, email tickets |

Each agent is a YAML file under `departments/<dept>/<agent>.yaml`. Add a file → add an agent.

### Event bus pattern

Agents communicate over an HMAC-signed Redis event bus with schema validation, replay prevention, and a verified `SafeEventContext` projection injected into LLM prompts. Triggers (cron, webhook, slash command, channel message) emit events; agent subscriptions match by topic; the dispatcher routes to the agent's executor (CLI, Pi, or built-in actions).

### 4-layer context cache

LLM calls share a four-layer prompt structure: **(1)** static system prompts, **(2)** persistent agent memory, **(3)** rolling conversation context, **(4)** live tool-use turn. Layers 1-3 are marked with Anthropic `cache_control` so cache hits land on every multi-turn call. See [`docs/PROMPT-SYSTEM.md`](docs/PROMPT-SYSTEM.md).

---

## Configuration

### Where things live

| Path | What it controls |
|------|-----------------|
| `.env` | Secrets, API keys, DB connection strings, feature flags |
| `prompts/*.md` | The eight driver files your AI assistant edits to define the org |
| `departments/<dept>/<agent>.yaml` | Per-agent config — model, prompts, triggers, actions |
| `yclaw.config.example.yaml` | Infrastructure adapter selection (Mongo/Redis/Postgres/S3/etc.) |
| `repos/` | Per-repo codegen configs for the autonomous PR pipeline |

### Key environment variables

| Variable | Required | Default | Notes |
|----------|---------|---------|-------|
| `ANTHROPIC_API_KEY` | ✅ one of | — | Or `OPENAI_API_KEY` / `OPENROUTER_API_KEY` / `GEMINI_API_KEY` |
| `MONGODB_URI` | ✅ | `mongodb://mongo:27017/yclaw` | docker-compose hostname |
| `REDIS_URL` | ✅ | `redis://redis:6379` | docker-compose hostname |
| `MEMORY_DATABASE_URL` | ✅ | `postgresql://yclaw:yclaw_dev@postgres:5432/yclaw_memory` | docker-compose hostname |
| `API_PORT` | — | `3000` | Host port for the core API |
| `MC_PORT` | — | `3001` | Host port for Mission Control |
| `POSTGRES_PASSWORD` | — | `yclaw_dev` | Local-only password for the bundled postgres |
| `NEXTAUTH_SECRET` | for MC auth | — | `openssl rand -base64 32` |

See [`.env.example`](./.env.example) for the full list (~120 variables, grouped by integration).

### Customizing the org

1. Edit `prompts/mission_statement.md`, `prompts/brand-voice.md`, etc.
2. Edit `departments/<dept>/<agent>.yaml` to change models, triggers, or system prompts
3. `docker compose restart api` — agents pick up new configs on boot

---

## Prerequisites

- **Docker Engine 24+** with **Docker Compose v2** (`docker compose`, not `docker-compose`)
- **Node.js 20+** — only required for local development outside containers
- **At least one LLM API key** — Anthropic recommended (`claude-opus-4-6` is the default)
- **4 GB+ free RAM** — peak: ~3 GB across all five services
- **Free ports**: `3000` (API), `3001` (Mission Control), `27017` (Mongo), `6379` (Redis), `5432` (Postgres). Override via `API_PORT` / `MC_PORT` in `.env` if needed.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| `docker compose up` fails with `bind: address already in use` | Port 3000/3001/5432/6379/27017 already taken | Set `API_PORT=3010` (or any free port) in `.env` and re-run; for DB ports, stop the local service (`brew services stop postgresql`, etc.) |
| API container restart-loops with `ANTHROPIC_API_KEY missing` | `.env` not populated | `cp .env.example .env` and add a real key |
| API logs `connect ECONNREFUSED postgres:5432` | Postgres still booting on first run | Wait ~30s; healthcheck will resolve and the API will retry. If it persists, run `docker compose logs postgres` |
| `/api/memory-status` returns `{"connected":true,"tables":[]}` | Memory migrations never ran | `curl -X POST http://localhost:3000/api/migrate` |
| Mission Control shows "API unreachable" | API container unhealthy | `docker compose ps` — check the `api` service status; `docker compose logs api` for the stack trace |
| `mongo` healthcheck fails on Apple Silicon | Outdated `mongo:7` image | `docker compose pull mongo && docker compose up -d` |
| Stale data after schema change | Old volume contents | `docker compose down -v` (⚠️ deletes all data) then `docker compose up -d` |

---

## Contributing

See [`CONTRIBUTING.md`](./CONTRIBUTING.md) for the full guide. Quick version:

```bash
git clone https://github.com/YClawAI/yclaw.git
cd yclaw
npm install
npm test
npx tsc -p packages/core/tsconfig.json --noEmit
```

PRs against `main`. One logical change per commit. Every PR runs the agent-safety, dependency-gate, and security-alerts workflows — protected paths (`packages/core/src/security/**`, workflows, `Dockerfile*`) require an admin label.

---

## License

YCLAW is licensed under [**AGPL-3.0-or-later**](./LICENSE).

What this means in practice:
- **You can run YCLAW privately** — no obligations.
- **You can fork and modify YCLAW** — you must keep your fork AGPL.
- **If you deploy YCLAW as a network service** that users interact with, you must offer the modified source code to those users (the AGPL §13 network clause).
- **You cannot relicense** YCLAW as proprietary software.

If you need a commercial license without the AGPL §13 obligations, [open a discussion](https://github.com/YClawAI/yclaw/discussions).
