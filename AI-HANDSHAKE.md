# The AI-to-AI Handshake

> YCLAW's core onboarding mechanism. Your AI programs our AI.

## The Concept

You already have an AI assistant. It knows your business — your mission, your priorities, your brand, your tech stack, who's in charge. YCLAW agents need all that same context to be useful.

The AI Handshake bridges the gap: your existing AI generates a structured onboarding packet that YCLAW consumes to program its agents. No forms, no 50-question wizards, no copying and pasting between docs.

**Your AI already knows. YCLAW just needs it to write it down.**

## How It Works

### Step 1: Install YCLAW
```bash
git clone https://github.com/YClawAI/yclaw.git && cd yclaw
cp .env.example .env    # add your LLM API key
docker compose up -d
```

### Step 2: Give Your AI the Handshake Prompt
Copy the contents of `ONBOARDING_PROMPT.md` and paste it into whatever AI you already use — Claude, ChatGPT, Cursor, Codex, Gemini, OpenClaw, anything with context about your organization.

Your AI will generate `yclaw-init.yaml` — a structured file containing everything YCLAW agents need to know about your org.

### Step 3: Import and Boot
```bash
./scripts/onboard.sh --from yclaw-init.yaml
```

This generates all the prompt files your agents load on every execution:
- `prompts/mission_statement.md` — what your org is and believes
- `prompts/chain-of-command.md` — who's in charge, escalation rules
- `prompts/protocol-overview.md` — what you build, technically
- `prompts/brand-voice.md` — how agents communicate externally
- `prompts/executive-directive.md` — current priorities and KPIs
- `prompts/engineering-standards.md` — dev standards and conventions
- `departments/*/agent.yaml` — agent configs with triggers, actions, prompts
- `departments/*-workflow.md` — per-agent workflow instructions

### Step 4: Validate and Go Live
```bash
./scripts/validate.sh     # structural + semantic + runtime checks
./scripts/activate.sh     # agents boot with YOUR context
```

## Why This Works

Traditional onboarding asks YOU to fill in forms. But you hired an AI assistant precisely so you don't have to do that. The Handshake lets your AI do what it's good at — synthesizing everything it knows about you into a structured format another system can consume.

The result: YCLAW agents that actually understand your business from minute one.

## The Onboarding Packet Schema

Your AI generates a YAML file matching this structure:

```yaml
org:
  name: "Your Org Name"
  mission: |
    What your organization does, why it exists, what it believes.
    This becomes mission_statement.md — loaded by every agent on every execution.
    Be specific. This is the soul of your agents.
  
  chain_of_command: |
    Who the human decision-makers are.
    Authority hierarchy. Escalation rules.
    What agents can decide autonomously vs what needs human approval.
  
  product_overview: |
    Technical description of what you build.
    Architecture, stack, key systems, APIs.
    Agents reference this when making technical decisions.
  
  brand_voice: |
    How agents should communicate externally.
    Tone, vocabulary, examples of good/bad copy.
    What to say, what never to say.
  
  priorities: |
    Current strategic priorities. What matters THIS quarter.
    KPIs, deadlines, constraints, risks.
    Updated regularly — this is the executive directive.
  
  engineering_standards: |
    Coding standards, testing requirements, PR process.
    Architecture patterns, security rules, deployment practices.
    What "good code" means in your org.

departments:
  - name: executive
    agents:
      - name: strategist
        description: "Sets priorities, coordinates across departments"
        model: claude-sonnet-4-20250514
        
  - name: development  
    agents:
      - name: architect
        description: "Technical lead, plans and reviews"
        model: claude-sonnet-4-20250514
      - name: builder
        description: "Executes code tasks from architect specs"
        model: claude-sonnet-4-20250514

  - name: marketing
    agents:
      - name: ember
        description: "Social media, content creation"
        model: claude-sonnet-4-20250514

# Optional: sources for deeper context
sources:
  websites:
    - https://yoursite.com
  github_repos:
    - https://github.com/your-org/your-repo
  documents:
    - path/to/brand-guide.pdf
    - path/to/strategy-doc.md
```

## What Gets Generated

The onboarding script reads your packet and generates the exact files the 4-layer context cache loads:

| Layer | Files | Purpose |
|-------|-------|---------|
| **Layer 1 (Global)** | `mission_statement.md`, `chain-of-command.md`, `protocol-overview.md` | Loaded by EVERY agent, EVERY execution |
| **Layer 2 (Role)** | `brand-voice.md`, `executive-directive.md`, `engineering-standards.md`, `*-workflow.md` | Per-department/agent prompts |
| **Layer 3 (Memory)** | Postgres records | Org memory, department memory, agent memory |
| **Layer 4 (Dynamic)** | Auto-recall + task data | Changes every execution |

## Alternate Paths

Not every user's AI will have full org context. The Handshake also supports:

- **Conversational fallback** — `./scripts/onboard.sh` asks questions interactively for any fields your AI couldn't fill
- **Source ingestion** — point at GitHub repos, websites, or docs and let YCLAW extract context
- **Direct editing** — all generated files are plain markdown and YAML. Edit them anytime.

## After Onboarding

All context lives in `prompts/` and `departments/`. These are just files. Your AI assistant (or you) can edit them at any time. Changes are picked up on next agent execution or via reload.

The agents will continuously improve their own context through the Claudeception learning system — extracting reusable knowledge from their work and writing it back to memory and skills.
