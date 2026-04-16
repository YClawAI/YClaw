# YCLAW FAQ Knowledge Base

This is the central FAQ knowledge base for YCLAW. Agents (especially Keeper, Guide, and
Scout) reference these entries when answering community questions across GitHub
Discussions, Discord, X, and inbound support channels.

**Answer style:**
- Direct, technical, no hype
- No exclamation marks
- Use proper terminology: `agent`, `department`, `event bus`, `approval gate`, `action`
- Link to `docs/ARCHITECTURE.md`, `CLAUDE.md`, or specific source files when useful
- Never promise features that aren't in the current codebase

---

## 1. Getting Started

### Q: What is YCLAW?
**A:** YCLAW is an open-source AI agent orchestration framework. It provides the
infrastructure to run an organization of AI agents — departments, event-driven
coordination, approval gates, persistent memory, and production deployment. It was
extracted from a production system that ran 12 autonomous agents for over a year. It
is released under AGPL-3.0, self-hosted, and model-agnostic.
**Confidence:** high
**Platforms:** github, discord, x

### Q: How do I deploy YCLAW?
**A:** YCLAW deploys via Docker Compose for local development or ECS Fargate for
production. The short path: clone `YClawAI/YClaw`, set your secrets, run
`docker compose up`, then connect an AI assistant to handle agent programming.
The full quickstart is in the README and `docs/`.
**Confidence:** high
**Platforms:** github, discord, x

### Q: What runtime does YCLAW require?
**A:** Node 20 LTS, MongoDB, and Redis. YCLAW is an ESM TypeScript monorepo
managed with turborepo and npm.
**Confidence:** high
**Platforms:** github, discord

### Q: Is YCLAW open source?
**A:** Yes. AGPL-3.0. Source is at https://github.com/YClawAI/YClaw.
**Confidence:** high
**Platforms:** github, discord, x

### Q: Is YCLAW a hosted/managed service?
**A:** No. YCLAW is self-hosted infrastructure. You deploy and run it on your own
hardware, your own cloud account, or anywhere that supports Node + MongoDB + Redis.
**Confidence:** high
**Platforms:** github, discord, x

### Q: What LLM providers does YCLAW support?
**A:** YCLAW is model-agnostic. It ships with adapters for Anthropic, OpenAI, Google,
and OpenRouter, and any provider that implements the supported chat/completion API.
Per-agent and per-task model overrides are declared in YAML.
**Confidence:** high
**Platforms:** github, discord

### Q: Who built YCLAW?
**A:** YCLAW was extracted from a production agent system that operated for over a
year before being open-sourced. Maintainers and contributors are credited in the
GitHub repo under `CODEOWNERS` and via commit history.
**Confidence:** high
**Platforms:** github, discord

---

## 2. Agents & Departments

### Q: What's an "agent" in YCLAW?
**A:** An agent is an autonomous AI worker with a specific role, a model configuration,
a set of system prompts loaded on every run, a declared list of actions (tools) it can
call, and subscriptions to events on the event bus. Each agent is defined by a YAML
file under `departments/<dept>/<agent>.yaml`.
**Confidence:** high
**Platforms:** github, discord

### Q: What agents does YCLAW ship with?
**A:** 13 agents in 6 departments — Executive (strategist, reviewer), Development
(architect, designer, mechanic), Marketing (ember, forge, scout), Operations (sentinel,
librarian), Finance (treasurer), and Support (guide, keeper). Each agent's YAML config
and system prompts are in the repo.
**Confidence:** high
**Platforms:** github, discord

### Q: Can I add my own agents?
**A:** Yes. Drop a YAML config under `departments/<dept>/<agent>.yaml`, add any new
system prompts to `prompts/`, and restart the runtime. Agents can reuse shared skills
in `skills/shared/` or declare their own in `skills/<agent>/`.
**Confidence:** high
**Platforms:** github, discord

### Q: Can I remove agents I don't need?
**A:** Yes. Remove or archive the YAML config. The runtime only loads agents defined
under `departments/`. Be careful about downstream event consumers — if an agent
publishes events others subscribe to, removing it may leave consumers idle.
**Confidence:** high
**Platforms:** github, discord

### Q: How do agents communicate?
**A:** Through the event bus (Redis Streams with HMAC-signed envelopes). Events follow
the `source:type` pattern — e.g., `builder:pr_ready`, `architect:pr_review`. Each agent
declares `event_subscriptions` and `event_publications` in its YAML.
**Confidence:** high
**Platforms:** github, discord

### Q: What triggers an agent to run?
**A:** Three trigger types: cron (scheduled), event (pub/sub), and webhook (external,
normalized into internal events). A special `batch_event` trigger waits for N matching
events or a timeout before firing.
**Confidence:** high
**Platforms:** github, discord

---

## 3. Safety & Approval Gates

### Q: How does YCLAW prevent agents from doing dangerous things?
**A:** Layered safety — (1) per-agent action allow-lists in YAML, (2) approval gates
on high-risk actions (`deploy:execute`, `safety:modify`, etc.), (3) the Reviewer agent
gates external-facing content, (4) outbound safety filter catches credential leaks and
brand violations, and (5) the YCLAW repo itself is excluded from codegen
(self-modification protection).
**Confidence:** high
**Platforms:** github, discord

### Q: What requires human approval?
**A:** Actions classified as `critical` risk (e.g., modifying safety infrastructure,
new external integrations, cost above threshold) require explicit human approval
through Mission Control. The full mapping is in `packages/core/src/approvals/gates.ts`.
**Confidence:** high
**Platforms:** github, discord

### Q: How do I review what agents are doing?
**A:** Mission Control is a Next.js dashboard that runs alongside the API. It shows
live agent activity, pending approvals, audit logs, and task state. Default URL is
configured at deploy time (reference production uses `agents.yclaw.ai`).
**Confidence:** high
**Platforms:** github, discord

### Q: Can agents modify the YCLAW codebase itself?
**A:** No. The YCLAW repo is excluded from the codegen subsystem — agents cannot
submit PRs to modify their own infrastructure. Self-modification protection is
enforced in `packages/core/src/config/repo-loader.ts`.
**Confidence:** high
**Platforms:** github, discord

---

## 4. Configuration & Customization

### Q: How do I configure an agent?
**A:** Edit its YAML in `departments/<dept>/<agent>.yaml`. Key fields are `model`,
`system_prompts`, `triggers`, `actions`, `event_subscriptions`, and
`event_publications`. Changes take effect on the next runtime restart.
**Confidence:** high
**Platforms:** github, discord

### Q: How do I add a custom action (tool)?
**A:** Implement the action executor in `packages/core/src/actions/`, register it in
the action registry, then add the action name to any agent's YAML `actions` list.
Actions are scoped per-agent — only declared actions are available to the LLM at
runtime.
**Confidence:** high
**Platforms:** github, discord

### Q: How do I add a new repo for agents to work on?
**A:** Two options — static (recommended): add `repos/<name>.yaml`. Dynamic: call the
`repo:register` action at runtime. Static configs take precedence when both exist.
See `packages/core/src/config/repo-registry.ts`.
**Confidence:** high
**Platforms:** github, discord

### Q: Where does agent memory live?
**A:** MongoDB. Each agent has its own namespace. Memory survives restarts and
deploys. Agents read and write memory via `self:memory_read` / `self:memory_write`
actions (subject to safety gates).
**Confidence:** high
**Platforms:** github, discord

---

## 5. Contributing

### Q: How do I contribute to YCLAW?
**A:** Fork the repo, create a branch (`feat/...`, `fix/...`, `docs/...`), submit a PR
targeting `main`. All PRs are squash-merged. CI must pass. See `CONTRIBUTING.md` for
the full workflow.
**Confidence:** high
**Platforms:** github, discord

### Q: Can AI tools author PRs?
**A:** Yes — that's the point. AI-authored PRs must be marked with the `ai-authored`
label and still pass CI and reviewer approval.
**Confidence:** high
**Platforms:** github, discord

### Q: What is versioned how?
**A:** CalVer — `YYYY.M.D` format. Releases are manual; a maintainer triggers the
publish workflow with a version tag. No Changesets, no semantic-release.
**Confidence:** high
**Platforms:** github, discord

---

## 6. Troubleshooting

### Q: My agent isn't triggering. What do I check?
**A:** (1) Is the cron/event/webhook actually firing? Check logs in Mission Control.
(2) Are `event_subscriptions` in the YAML correct? Event names must match exactly,
including the `source:type` prefix. (3) Is the agent's trigger gated by approval?
(4) Is Redis reachable?
**Confidence:** high
**Platforms:** github, discord

### Q: Events are publishing but subscribers never fire.
**A:** Check for the double-prefix bug — if an agent emits `strategist:slack_delegation`
but the EventBus constructs the dispatch key by prepending `source:` again, you get
`strategist:strategist:slack_delegation`. Subscribers listening for the correct name
never match. Verify the event name at the publish site.
**Confidence:** high
**Platforms:** github, discord

### Q: Deploy keeps failing with "approval required" even after I approved.
**A:** Approvals are action-specific, not session-wide. A prior approval doesn't carry
into a new deploy. Also, if two approval paths apply to the same action, one can race
ahead of the other — audit `gates.ts` for overlapping classifications.
**Confidence:** medium
**Platforms:** github, discord

### Q: LLM costs are spiking. How do I investigate?
**A:** Check Mission Control cost dashboards (per-agent, per-task). Audit which agents
have expensive models (Opus, GPT-4) set for frequent tasks like heartbeats — those
should usually run on cheaper models. Per-task model overrides are in each agent's
trigger config.
**Confidence:** high
**Platforms:** github, discord

---

## 7. Security & Trust

### Q: Is YCLAW safe to run with real credentials?
**A:** YCLAW is designed to minimize credential exposure — scoped actions, approval
gates for high-risk operations, outbound safety filter, and the review gate. That
said, any agent system is only as safe as its configuration — keep secrets in a
proper secrets manager, audit action allow-lists, and review approval gate classification
before production use.
**Confidence:** high
**Platforms:** github, discord

### Q: Does YCLAW have a security policy?
**A:** Yes — see `SECURITY.md` in the repo for reporting and handling of
vulnerabilities.
**Confidence:** high
**Platforms:** github, discord

### Q: Can I audit what an agent did?
**A:** Yes. Every agent execution writes to the audit log, including the trigger, the
tool calls made, the tokens consumed, and the final outcome. Mission Control
surfaces this data per-agent and per-correlationId.
**Confidence:** high
**Platforms:** github, discord

---

## Appendix: Key Terminology

- **Agent:** An autonomous AI worker defined by `departments/<dept>/<agent>.yaml`.
- **Department:** A logical grouping of agents (Executive, Development, Marketing, Operations, Finance, Support).
- **Event Bus:** Redis Streams pub/sub with HMAC-signed envelopes.
- **Approval Gate:** A per-action checkpoint requiring human or senior-agent approval before high-risk operations run.
- **Action:** A tool an agent can invoke (e.g., `github:commit_file`, `event:publish`). Declared per-agent in YAML.
- **Trigger:** What causes an agent to run — cron, event, or webhook.
- **Mission Control:** The Next.js dashboard that monitors agents and surfaces approvals.
- **AO (Autonomous Operator):** The code-change pipeline through which agents propose, review, and merge changes.
- **Skill:** A scoped knowledge asset loaded on demand. Shared skills apply to all agents; per-agent skills are scoped to one agent.

---

**Last Updated:** 2026
**Maintained By:** YCLAW maintainers
