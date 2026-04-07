# 🗺️ YCLAW Roadmap

## v0.1 — Foundation (Current)

The core framework. Everything you need to deploy and run an AI organization.

- Installer CLI (`yclaw init`, `doctor`, `deploy`, `destroy`, `status`, `config validate`)
- Docker Compose deployment with health checks and service profiles
- AWS Terraform deployment (ECS Fargate, RDS, ElastiCache, S3, ALB)
- 12 agent roles across 6 departments
- 4-tier operator RBAC with department scoping
- Conversational onboarding with file/URL/GitHub ingestion
- Health system, 17 error codes, audit timeline, structured logging
- HMAC-signed event bus with schema validation
- Multi-channel support (Discord, Slack, Telegram, Twitter/X)
- Safety floors, circuit breakers, egress allowlists

## v0.2 — Smarter Departments

Make departments actually learn and adapt.

- Adaptive task routing — departments learn which agent handles which type of work best
- Cross-department collaboration protocols — formalized handoffs between departments
- Department efficiency metrics — track throughput, error rates, cost per task
- Improved agent handoffs — context preservation when work passes between agents

## v0.3 — DAO Integration

On-chain governance for AI organizations.

- Governance proposals tied to agent actions — "should the marketing department increase spend?"
- Multi-chain voting mechanisms (Solana, Ethereum, L2s)
- Treasury governance — on-chain approval for large transfers
- Agent accountability through on-chain audit trails
- Token-gated operator access

## v0.4 — Mission Control Redesign

A dashboard that actually shows you what's happening.

- Real-time agent activity feeds — watch agents work live
- Improved dashboard UX — less terminal aesthetic, more operational clarity
- Mobile-responsive design — manage your AI org from your phone
- Operator notifications — get pinged when agents need human input
- Department drill-downs — see individual agent performance and history

## v0.5 — Speed Delivery

Make the whole system faster.

- Streaming agent responses — see results as they're generated
- Parallel task processing — multiple agents working simultaneously within a department
- Faster cold starts — reduce time from trigger to first LLM call
- Optimized event bus — batch processing for high-throughput scenarios
- Caching layer for repeated queries

## v0.6 — Agent Self-Upgrading

Agents that get better at their jobs without human intervention.

- Autonomous prompt evolution — agents refine their own system prompts based on task outcomes
- Skill discovery — agents identify and extract reusable patterns from their work
- Configuration recommendations — "I'd work better with a higher temperature for creative tasks"
- Cross-agent knowledge transfer — skills learned by one agent become available to others
- All self-modification gated by the safety system — agents can evolve, but guardrails remain immutable

---

Timeline is approximate. We ship when it's ready, not when the calendar says so.

Want to help shape the roadmap? [Open a discussion](https://github.com/YClawAI/yclaw/discussions).
