# The AI-to-AI Handshake

> YCLAW's core onboarding mechanism. Your AI programs our AI.

## The Concept

You already have an AI assistant. It knows your business — your mission, your priorities, your brand, your tech stack, who's in charge. YCLAW agents need all that same context to be useful.

The AI Handshake bridges the gap: your existing AI sets up YCLAW using the built-in CLI and onboarding flow, programming the agents with your org's context. No forms, no 50-question wizards, no copying and pasting between docs.

**Your AI already knows. YCLAW just needs it to write it down.**

## How It Works

### Step 1: Install YCLAW
```bash
git clone https://github.com/YClawAI/yclaw.git && cd yclaw
cp .env.example .env    # add your LLM API key
docker compose up -d --build
```

### Step 2: Run the CLI Setup
```bash
npx yclaw init                    # Guided wizard — infrastructure, channels, LLM, networking
npx yclaw doctor                  # Preflight validation — checks all prerequisites
npx yclaw deploy                  # Deploy from generated config
```

The `init` wizard walks through:
1. **Purpose** — evaluate locally, small team, or production org
2. **Infrastructure** — Docker Compose, AWS, GCP, K8s
3. **Channels** — Discord, Slack, Telegram, Twitter/X
4. **LLM Provider** — Anthropic, OpenAI, OpenRouter, local models
5. **Networking** — local only, Tailscale, VPN, public
6. **Review** — generates `yclaw.config.yaml` for approval

### Step 3: Onboarding — Program Your Agents

Once deployed, the onboarding API guides your AI through 6 stages:

| Stage | What happens | What gets generated |
|-------|-------------|-------------------|
| 1. **Org Framing** | Mission, priorities, brand voice, departments, tools | `org_profile`, `priorities`, `brand_voice` artifacts |
| 2. **Ingestion** | Upload docs, GitHub repos, URLs, text | Indexed context for agent memory |
| 3. **Departments** | Review and customize department configs | Department YAML + workflow prompts |
| 4. **Operators** | Invite additional operators | Operator accounts with RBAC tiers |
| 5. **Validation** | Verify all configs are sound | Validation report |
| 6. **Complete** | Agents boot with real context | Live agents |

The onboarding service lives at `POST /v1/onboarding/*` and is driven by authenticated API calls. Your AI assistant hits these endpoints to progress through each stage.

See [docs/onboarding.md](docs/onboarding.md) for the full API reference.

### Step 4: First Operator Bootstrap

On first boot with zero operators:
```bash
curl -X POST http://localhost:3000/v1/operators/bootstrap \
  -H "Authorization: Bearer $YCLAW_SETUP_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "Your Name", "email": "you@example.com"}'
```

This creates the root operator and returns an API key (shown once). The bootstrap endpoint self-disables after first use.

## The 4-Layer Context Cache

Every agent execution builds its system prompt from 4 layers:

| Layer | What | Source | Caching |
|-------|------|--------|---------|
| **Layer 1** | Global static — `mission_statement.md`, `chain-of-command.md`, `protocol-overview.md` | `prompts/` directory | Cached (ephemeral) |
| **Layer 2** | Department/role — `brand-voice.md`, `executive-directive.md`, `*-workflow.md` | `prompts/` directory | Cached (ephemeral) |
| **Layer 3** | Memory — org memory, department memory, agent memory | PostgreSQL | Cached (semi-static) |
| **Layer 4** | Dynamic — auto-recall snippets, task payload, event data | Per-execution | Not cached |

The onboarding flow generates the Layer 1 and 2 prompt files and seeds Layer 3 memory. This is what makes agents actually understand your business instead of being generic shells.

## What Gets Generated

After onboarding, your `prompts/` directory contains:

| File | Generated from | Loaded by |
|------|---------------|-----------|
| `mission_statement.md` | "What does your org do?" | Every agent, every execution |
| `chain-of-command.md` | "Who's in charge?" | Every agent, every execution |
| `protocol-overview.md` | "What do you build?" | Every agent, every execution |
| `brand-voice.md` | "How should agents communicate?" | Marketing, support agents |
| `executive-directive.md` | "Current priorities?" | Strategist + downstream |
| `engineering-standards.md` | "Dev standards?" | Development department |
| `*-workflow.md` | Per-agent role definition | Individual agents |

Each agent's YAML config in `departments/*/agent.yaml` lists exactly which prompts it loads.

## After Onboarding

All context lives in `prompts/` and `departments/`. These are just files — your AI assistant (or you) can edit them at any time. Changes are picked up on next agent execution.

The agents continuously improve their own context through the Claudeception learning system — extracting reusable knowledge from their work and writing it back to memory and skills.

## Reference Files

- [docs/onboarding.md](docs/onboarding.md) — Full onboarding API reference
- [docs/quickstart.md](docs/quickstart.md) — Quick start guide
- [docs/cli.md](docs/cli.md) — CLI command reference
- [docs/operators.md](docs/operators.md) — Operator RBAC documentation
- [docs/architecture.md](docs/architecture.md) — System architecture
