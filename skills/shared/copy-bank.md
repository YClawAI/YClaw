# YCLAW — Copy Bank

> Pre-approved copy for YCLAW external surfaces. Use this first. If the copy you need isn't
> here, write new copy following `prompts/brand-voice.md` and submit to Reviewer.
>
> All copy here is factual, self-hosted, OSS-first. No fabricated metrics, no financial
> language, no claims YCLAW doesn't back in code.

---

## Tagline & Positioning

### Taglines (pick one per context)

- "AI agent orchestration, built for teams that ship."
- "Agents with departments, not demos."
- "The open-source harness for multi-agent organizations."
- "Run an org of AI agents on infrastructure you own."

### One-line descriptions

- "Open-source AI agent orchestration framework with real departments, event-driven coordination, and human-in-the-loop approval gates."
- "Self-hosted, model-agnostic infrastructure for running autonomous AI agent organizations."

### Longer description (README / website hero)

YCLAW is the infrastructure to run an organization of AI agents — departments, event-driven coordination, approval gates, persistent memory, and production-grade deployment. Extracted from a system that ran 12 autonomous agents for over a year. Self-hosted under AGPL-3.0. Model-agnostic.

---

## Landing Page (yclaw.ai)

### Hero

**Headline options (pick one):**
- "AI agent orchestration, built for teams that ship."
- "Agents, coordinated."
- "The open-source harness for multi-agent organizations."

**Subheadline:**
"Departments, events, approvals, memory — the infrastructure AI agents need to actually work together. Self-hosted. Model-agnostic. AGPL-3.0."

**Primary CTAs:**
- "Read the Docs"
- "View on GitHub"

**Secondary CTA:**
- "Deploy YCLAW"

### Feature Grid

**Department Structure**
"Organize agents into real departments — Executive, Development, Marketing, Operations, Finance, Support. Each agent has a scoped role, configurable model, and declared actions."

**Event-Driven Coordination**
"Redis Streams event bus with HMAC-signed envelopes. Agents publish and subscribe to typed events. No polling, no brittle prompt chains."

**Approval Gates**
"Human-in-the-loop checkpoints for high-risk actions. Configure per-action risk tiers. Deploys, safety changes, and external integrations all pass through governed approval."

**Persistent Agent Memory**
"MongoDB-backed per-agent memory that survives across executions. Agents remember, reflect, and learn without rebuilding context every run."

**Model-Agnostic**
"Works with Anthropic, OpenAI, Google, OpenRouter, or any compatible LLM provider. Per-agent, per-task model overrides. No vendor lock-in."

**Self-Hosted**
"Docker Compose deploy or ECS Fargate. Your infrastructure, your data, your control. No SaaS dependency."

### Footer

"Open source under AGPL-3.0. Built on OpenClaw."

Links: Docs, GitHub, Architecture, Discord, License

---

## README — Key Sections

### One-paragraph pitch

YCLAW is an open-source AI agent orchestration framework. It gives you the infrastructure to run a full organization of AI agents — departments, event-driven coordination, approval gates, persistent memory, and production deployment — on infrastructure you own. Extracted from a system that ran 12 autonomous agents for over a year before open-sourcing. Self-hosted. Model-agnostic. AGPL-3.0.

### Quickstart preface

"YCLAW runs on Node 20 LTS, MongoDB, and Redis. Docker Compose for local development, ECS Fargate for production. Your AI assistant deploys YCLAW and then programs the agents using your organization's context — departments, prompts, schedules, events."

### Why YCLAW

- **Infrastructure, not demos.** Real department structures, event buses, approval gates.
- **Production-tested.** Ran 12 agents for over a year before open-sourcing.
- **Model-agnostic.** Anthropic, OpenAI, Google, OpenRouter — bring your own provider.
- **Self-hosted.** Docker Compose or ECS. Your data stays with you.
- **AGPL-3.0.** Fork it. Run it. Extend it. Contribute back.

---

## Social Posts (Reference Tone)

### X / Twitter (new feature announcement)

"YCLAW now supports [feature]. Departments, events, approvals — the infrastructure multi-agent systems need. Open source, self-hosted, model-agnostic. github.com/YClawAI/YClaw"

### X / Twitter (technical deep-dive opener)

"Our event bus uses HMAC-signed Redis Streams. Every inter-agent message is verifiable. Here's why that matters for multi-agent systems:"

### GitHub Release Notes (format)

```
## What's New

- <feature 1 — factual, one line>
- <feature 2 — factual, one line>

## Breaking Changes

- <what broke, what to do>

## Upgrade Notes

- <commands or steps>

Full changelog: https://github.com/YClawAI/YClaw/compare/<prev>...<this>
```

---

## Notifications

| Event | Copy |
|---|---|
| PR opened by agent | "[agent] opened PR #[N] on [repo]: [title]" |
| Deploy approved | "[env] deploy approved. Canary starting." |
| Deploy promoted | "[env] deploy promoted. Production live on v[version]." |
| Approval requested | "[agent] requested approval for [action]. Review in Mission Control." |
| Safety block | "[agent] content blocked by review gate: [reason]" |
| Circuit breaker open | "Project [project] circuit open (3 failures in 2h). Investigate before re-dispatching." |

---

## Error Messages

| Situation | Copy |
|---|---|
| Config invalid | "Agent config failed validation: [details]. Fix in `departments/<agent>.yaml`." |
| Missing secret | "Required secret [name] not found. Add it to your secrets manager before retrying." |
| Approval timeout | "Action timed out waiting for approval. Retry or escalate in Mission Control." |
| LLM provider error | "LLM call failed: [provider] returned [status]. Check provider status and credentials." |
| Event bus unavailable | "Event bus unreachable. Agents will resume coordination once Redis recovers." |

---

## Empty States

| Context | Copy |
|---|---|
| No active tasks | "No active tasks. Agents are idle or awaiting triggers." |
| No pending approvals | "No approvals pending. Everything high-risk has been reviewed." |
| No recent events | "No recent events on this channel." |
| No agents in department | "No agents configured in this department. Add one in `departments/`." |

---

## Meta / SEO

**Title tag:** "YCLAW — Open-source AI agent orchestration framework"
**Meta description:** "Run an organization of AI agents with real departments, event-driven coordination, and human-in-the-loop approval gates. Self-hosted. Model-agnostic. AGPL-3.0."
**OG image text:** "Agents, coordinated."

---

## Words We Use / Words We Don't

See `prompts/brand-voice.md` for the canonical list. Short version:

| Use | Don't Use |
|---|---|
| Agent orchestration | AI-powered solution |
| Open source | Proprietary |
| Self-hosted | Cloud-only |
| Model-agnostic | AI/ML (generic) |
| Department structure | Org chart |
| Event-driven | Real-time (overloaded) |
| Approval gate | Manual review (vague) |
