# 🦞 YCLAW

<p align="center">
  <strong>Your AI assistant just got a company to run.</strong>
</p>

<p align="center">
  An open-source AI org — 12 agents, 6 departments, multi-chain treasury,<br>
  full governance — steered by YOUR AI assistant through 8 markdown files.<br><br>
  Extracted from a production system that ran 12 autonomous agents for over a year. This is the open-source engine — v0.1.
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

<p align="center">
  <a href="docs/quickstart.md">Docs</a>
</p>

---

## Quick Start

Prerequisites: [Docker](https://docs.docker.com/get-docker/) and [Node.js 20+](https://nodejs.org).

```bash
npx yclaw init --preset local-demo
npx yclaw deploy
```

Open [http://localhost:3001](http://localhost:3001). That's Mission Control. Your AI org is running.

See [docs/quickstart.md](docs/quickstart.md) for the full walkthrough.

---

## What is YCLAW?

Most AI frameworks give you agents. YCLAW gives your AI assistant an **organization** to run.

Your AI assistant ([OpenClaw](https://openclaw.ai)) docks in as the root operator. It doesn't just answer questions — it manages departments, delegates work, tracks treasury across blockchains, and runs the whole operation. You control everything through 8 markdown files.

We didn't build this for a demo day. We built it to run our own company, ran 12 autonomous agents in production for over a year, and open-sourced the engine.

**No telemetry. No phone-home. Your data stays on your infrastructure.**

---

## 💡 Your AI + Their AI + One Organization

Everyone has a personal AI assistant now. But yours can't talk to theirs, and neither can actually *run* anything together.

YCLAW is the shared operating layer. You decide the structure — departments, permissions, chain of command, treasury access — and configure how your AI works alongside your cofounder's, your team's, or your contractors'. Every action is logged: which AI did what, on behalf of which human.

Agent frameworks let one developer orchestrate their own pipelines. YCLAW lets **multiple people, with their own AI assistants, co-operate a single organization** — configured however you want it to work.

---

## Customize Your Organization

YCLAW ships with 12 agent roles. To make them yours, edit these 8 driver documents:

| File | What It Defines | Example |
|------|----------------|---------|
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

| Department | Agents | What they do |
|------------|--------|-------------|
| **Executive** | Strategist, Reviewer | Set weekly priorities, synthesize standups, gate all external content |
| **Development** | Architect, Designer | Review PRs, enforce design systems, coordinate coding tasks |
| **Marketing** | Ember, Forge, Scout | Create content, generate images/video, monitor competitors |
| **Operations** | Sentinel, Librarian | Deploy health checks, code quality audits, knowledge curation |
| **Finance** | Treasurer | Multi-chain treasury monitoring, LLM spend tracking, financial reporting |
| **Support** | Guide, Keeper | Community moderation, escalated support, email tickets |

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
- **Multi-chain treasury** — Track wallets across Solana, Ethereum, L2s, and traditional finance from one operating model. Your AI org understands where the money is.
- **Self-aware agents** — Every agent knows its own config, source code, execution history, and the full org chart. They reason about their own software.
- **Autonomous pipeline** — Issues get assigned → code gets written → PRs get reviewed → CI passes → code ships. No human in the loop (unless you want one).
- **Event-driven coordination** — HMAC-signed Redis event bus. Strategist sends directives, Architect coordinates code changes, Reviewer gates content, Sentinel monitors deploys.
- **Continuous learning** — Agents extract reusable skills from every non-trivial task. The org gets smarter over time (Claudeception system).
- **Safety floors** — Immutable safety gates, protected config keys, brand review, outbound security scanning, full audit trails. Agents can evolve, but they can't override their guardrails.
- **Conversational onboarding** — Guided setup generates org profile, department configs, and brand voice from your answers. Drop files, link repos, paste URLs.
- **Built-in observability** — Health checks, 17 structured error codes, audit timeline, operator activity tracking.

---

## Architecture

```
  ┌──────────────────────────────────────────────────────────────┐
  │                      Mission Control                         │
  │              (Next.js Dashboard — port 3001)                 │
  └──────────────────────┬───────────────────────────────────────┘
                         │ HTTP
  ┌──────────────────────┴───────────────────────────────────────┐
  │                       Core Runtime                           │
  │  ┌─────────┐  ┌──────────┐  ┌──────────┐  ┌─────────────┐  │
  │  │Operators │  │Onboarding│  │  Agents  │  │Observability│  │
  │  │  (RBAC)  │  │  (Setup) │  │(12 roles)│  │  (Health)   │  │
  │  └─────────┘  └──────────┘  └──────────┘  └─────────────┘  │
  │  ┌─────────┐  ┌──────────┐  ┌──────────┐  ┌─────────────┐  │
  │  │ Safety  │  │ Review   │  │ Codegen  │  │  Reactions  │  │
  │  │ Guards  │  │  Gate    │  │(CLI/Pi)  │  │  (Auto-ops) │  │
  │  └─────────┘  └──────────┘  └──────────┘  └─────────────┘  │
  └──────┬──────────────┬───────────────┬───────────────┬───────┘
         │              │               │               │
  ┌──────┴──────┐ ┌─────┴─────┐ ┌──────┴──────┐ ┌─────┴──────┐
  │  MongoDB    │ │   Redis   │ │ PostgreSQL  │ │  Channels  │
  │ State/Audit │ │Events/KV  │ │   Memory    │ │Slack/Discord│
  └─────────────┘ └───────────┘ └─────────────┘ │Telegram/X  │
                                                 └────────────┘
```

---

<details>
<summary><strong>The CLI</strong></summary>

```bash
npx yclaw init          # Guided setup wizard
npx yclaw doctor        # Preflight validation
npx yclaw deploy        # Deploy from generated config
npx yclaw status        # Check system health
npx yclaw destroy       # Tear down infrastructure
npx yclaw config validate   # Validate yclaw.config.yaml
```

| Command | Key Flags | What it does |
|---------|-----------|-------------|
| `npx yclaw init` | `--preset`, `--non-interactive`, `--force` | Generate `yclaw.config.yaml` + `.env` |
| `npx yclaw doctor` | `--json` | Run 10+ diagnostic checks |
| `npx yclaw deploy` | `--dry-run`, `--detach`, `--dev`, `--skip-verification` | Deploy with selected executor |
| `npx yclaw destroy` | `--volumes`, `--force` | Stop containers, optionally remove data |
| `npx yclaw status` | `--json`, `--verbose`, `--api-url`, `--api-key` | Fetch health from running instance |
| `npx yclaw config validate` | `--config`, `--strict` | Schema-validate config file |

See [docs/cli.md](docs/cli.md) for the complete reference.

</details>

<details>
<summary><strong>Supported configurations</strong></summary>

| Component | Options | Default | Status |
|-----------|---------|---------|--------|
| State Store | MongoDB | MongoDB | Stable |
| Event Bus | Redis | Redis | Stable |
| Memory | PostgreSQL | PostgreSQL | Stable |
| Object Storage | Local filesystem, S3 | Local | Stable |
| Channels | Discord, Slack, Telegram, Twitter/X | (user chooses) | Stable |
| LLM Providers | Anthropic, OpenAI, OpenRouter | Anthropic | Stable |
| Secrets | `.env` file, AWS Secrets Manager | `.env` | Stable |
| Deployment | Docker Compose, AWS Terraform | Docker Compose | Stable |
| Networking | Local, Tailscale, Public | Local | Stable |

See [docs/configuration.md](docs/configuration.md) and [docs/adapters.md](docs/adapters.md).

</details>

<details>
<summary><strong>Safety and permissions</strong></summary>

Agents can evolve, but guardrails are immutable:

- **Safety floors** — Core files (`safety.ts`, `audit.ts`, `reviewer.ts`, `executor.ts`) cannot be modified by any agent, ever.
- **Protected config keys** — Agents can't edit their own `department`, `actions`, `triggers`, or `review_bypass`. Attempts trigger critical alerts.
- **Tiered modification** — Read-only (free), config updates (auto-logged), model/prompt changes (agent-reviewed), code changes (human-reviewed).
- **Outbound security** — Deterministic regex scanning blocks credential leaks and data exfiltration on every outbound action.
- **Brand review gate** — All external-facing content passes through the Reviewer agent before publication.
- **4-tier RBAC** — Root → department head → contributor → observer. Department-scoped permissions with full audit trail.
- **HMAC-signed event bus** — Every inter-agent event is cryptographically signed. Schema validation prevents injection.

See [docs/security.md](docs/security.md).

</details>

<details>
<summary><strong>Observability</strong></summary>

- `GET /health` — Liveness (always 200 if process alive)
- `GET /health/ready` — Readiness (critical deps available?)
- `GET /v1/observability/health` — Full breakdown with agent counts, task counts, error summary
- `GET /v1/observability/audit` — Cursor-paginated audit timeline
- `GET /v1/observability/errors` — Recent errors with codes and suggested fixes
- 17 structured error codes covering infra, LLM, agent, security, and channel failures
- `npx yclaw status` CLI with human and JSON output modes

See [docs/observability.md](docs/observability.md).

</details>

<details>
<summary><strong>Template variables</strong></summary>

Files in `prompts/`, `departments/`, and `docs/` use `{{PLACEHOLDER}}` syntax:

| Variable | Description |
|----------|-------------|
| `{{PROJECT_NAME}}` | Your project name |
| `{{ORG_NAME}}` | GitHub org or username |
| `{{ORG_DISPLAY_NAME}}` | Human-readable org name |
| `{{REPO_NAME}}` | Main repository name |
| `{{PROJECT_DOMAIN}}` | Your project's domain |
| `{{API_DOMAIN}}` | Agent API endpoint |
| `{{PROJECT_SLUG}}` | URL-safe project identifier |
| `{{ORG_HANDLE}}` | Social media handle |

</details>

---

## Presets

Skip the wizard with a preset:

| Preset | What You Get |
|--------|-------------|
| `local-demo` | Docker Compose, all-local services, no channels. Evaluation in 5 minutes. |
| `small-team` | Docker Compose, Slack enabled. Production-ready for small teams. |
| `aws-production` | AWS managed services (RDS, ElastiCache, S3), Slack + Discord. Full production. |

---

## 🗺️ Roadmap

| Focus |
|-------|
| ✅ Core framework, CLI, Docker Compose, AWS Terraform, onboarding, observability |
| 🔨 Smarter departments — adaptive task routing, cross-department collaboration, efficiency metrics |
| 🔌 Bring your own AI — connect OpenClaw, Claude, ChatGPT, Gemini, or any personal AI assistant as operator |
| ⛓️ DAO integration — on-chain governance across Solana, Ethereum, and L2s |
| 🎨 Mission Control redesign — real-time agent activity, improved UX, mobile dashboard |
| 🚀 Speed delivery — faster agent execution, streaming responses, parallel task processing |
| 🧬 Agent self-upgrading — agents evolve their own prompts, skills, and configurations autonomously |

See [ROADMAP.md](ROADMAP.md) for details.

---

## Documentation

| Doc | What It Covers |
|-----|---------------|
| [Quickstart](docs/quickstart.md) | Zero to running in 15 minutes |
| [CLI Reference](docs/cli.md) | All commands, flags, and exit codes |
| [Configuration](docs/configuration.md) | `yclaw.config.yaml` schema reference |
| [Architecture](docs/architecture.md) | System design, interfaces, data flow |
| [Operators](docs/operators.md) | RBAC tiers, permissions, invitations |
| [Onboarding](docs/onboarding.md) | Conversational setup flow |
| [Observability](docs/observability.md) | Health, errors, audit, debugging |
| [Security](docs/security.md) | 7 security domains, threat model |
| [Docker Compose](docs/deployment/docker-compose.md) | Local and VPS deployment |
| [AWS](docs/deployment/aws.md) | Production AWS deployment |
| [Adapters](docs/adapters.md) | Building custom channel/store adapters |

---

## Works With

- [OpenClaw](https://openclaw.ai) — The AI assistant that becomes your operator
- [ClawHub](https://clawhub.com) — Discover and install agent skills

---

## Disclaimer

YCLAW is provided "as-is" without warranty of any kind. You are solely responsible for cloud infrastructure costs, actions taken by AI agents, data stored or transmitted through the system, and compliance with applicable laws. The YCLAW authors are not liable for any damages arising from use of this software, including costs from LLM API usage or actions taken by AI agents. See [LICENSE](./LICENSE) for full terms.

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for dev setup, PR process, and how to build custom adapters.

---

## Security

YCLAW implements 7 security domains: dependency supply chain, Docker image security, CI/CD pipeline hardening, agent-specific safety gates, runtime container hardening, monitoring/incident response, and HMAC-signed event bus authentication.

See [SECURITY.md](SECURITY.md) for vulnerability reporting and the full security model.

---

## License

AGPL-3.0-or-later — see [LICENSE](./LICENSE)

---

<p align="center">
  Created by <a href="https://x.com/TroyMurs">@TroyMurs</a><br>
  Built on <a href="https://openclaw.ai">OpenClaw</a>
</p>
