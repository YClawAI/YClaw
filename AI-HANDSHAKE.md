# The AI Handshake

> The onboarding prompt your AI assistant follows when you hand it this repo.
>
> **Status: placeholder.** The full handshake document is being written. For now,
> this file describes the intended flow so an AI assistant can pattern-match it.

---

## What this file will contain

When you give your AI assistant access to this repo, it should treat this file
as its onboarding instructions. The full version will walk the assistant through:

1. **Reading the repo** — `README.md`, `prompts/`, `departments/`, `docs/architecture.md`
2. **Interviewing you** — about your mission, your team, your product, your priorities
3. **Generating the eight driver files** under `prompts/`:
   - `mission_statement.md` — why your org exists
   - `brand-voice.md` — how you sound
   - `chain-of-command.md` — who's in charge
   - `executive-directive.md` — current priorities
   - `protocol-overview.md` — what you do
   - `content-templates.md` — content formats
   - `design-system.md` — visual identity
   - `review-rules.md` — quality gates
4. **Configuring `.env`** from `.env.example` — surfacing required keys
5. **Bringing up the stack** — `docker compose up -d --build`
6. **Verifying** — health checks, Mission Control loads, root operator created
7. **Tuning** — watching the agents work and adjusting their `departments/<dept>/<agent>.yaml` configs

---

## In the meantime

Until the full handshake document is published, an AI assistant working with
this repo should:

- Read [`README.md`](./README.md) end-to-end
- Read [`docs/architecture.md`](./docs/architecture.md) for the system model
- Read [`docs/quickstart.md`](./docs/quickstart.md) for the deploy flow
- Read everything in [`prompts/`](./prompts/) as reference examples of what
  the eight driver files look like for a real deployment
- Read one or two `departments/*/<agent>.yaml` files to understand the
  per-agent config schema

Then proceed to interview the operator, generate the org's specific prompt
files, and bring up the stack via Docker Compose.

---

*This document will be replaced with the full handshake prompt before v0.1.0
ships. Track progress at [YClawAI/yclaw#1](https://github.com/YClawAI/yclaw/pull/1).*
