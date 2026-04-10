# YClaw Organization Profile

## Organization
- **Name:** YClaw
- **Type:** Open-source project under Graviton Inc
- **Stage:** Launched, early adoption phase
- **Industry:** AI infrastructure / developer tools

## Products & Services
YClaw is an open-source AI agent orchestration framework that enables organizations to deploy and coordinate teams of AI agents. Agents are organized into departments, communicate via events, and operate within safety guardrails.

### Key Capabilities
- **12 specialized agents** across 6 departments (executive, development, marketing, operations, finance, support)
- **Event-driven coordination** — agents react to events, not schedules
- **Model-agnostic** — works with Anthropic, OpenAI, Google, xAI, or local models
- **Self-hosted** — full control, no vendor lock-in
- **AI Handshake onboarding** — conversational setup that programs agents for your org
- **Safety gates** — deterministic review, content filtering, budget controls
- **Multi-channel output** — Discord, Slack, Telegram, Twitter/X

## Target Audience
- Startup founders and technical leads who want AI-powered operations
- Developer teams automating workflows (code review, CI/CD, docs)
- Open source maintainers coordinating community and releases
- Anyone who wants to run an autonomous AI organization

## Differentiators
1. **Organizational structure** — Not just agents, but departments with reporting lines, review gates, and shared context
2. **Fully open source** — MIT licensed, self-hostable, no black boxes
3. **Production-tested** — Battle-hardened from running Graviton's own operations
4. **AI Handshake** — Onboarding that lets your AI program the agents (not YAML editing)
5. **Framework, not platform** — You own the stack. Deploy it your way.

## Tech Stack
- TypeScript monorepo (Turborepo)
- MongoDB Atlas (agent memory, executions)
- Redis (rate limiting, event streams)
- AWS ECS Fargate (production deploy) / Docker Compose (local)
- GitHub Actions CI/CD
- Discord as primary communication channel

## Key Links
- Website: https://yclaw.ai
- GitHub: https://github.com/YClawAI/YClaw
- Parent company: Graviton Inc (Puerto Rico)
