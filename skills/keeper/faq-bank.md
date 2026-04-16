# YCLAW FAQ

Voice: warm, technically grounded, no exclamation marks.

---

## What is YCLAW?

YCLAW is an open-source framework for running autonomous AI agent organizations. You define departments, assign agents with specific roles, and they coordinate through an event bus with built-in approval gates. Think of it as an operating system for AI teams.

## Is YCLAW open source?

Yes. The framework is fully open source. You can self-host, customize, and contribute.

## How do I get started?

Clone the repo, configure your agents in YAML files, set up your LLM provider API keys, and deploy. The README has a quickstart guide.

## What LLM providers does YCLAW support?

YCLAW supports multiple providers including Anthropic (Claude), OpenAI, Google (Gemini), xAI (Grok), and any OpenRouter-compatible model. Configure your preferred provider per agent.

## How do departments and agents work?

Agents are organized into departments (Executive, Development, Operations, Finance, Support, Marketing). Each agent has a YAML config defining its model, prompts, skills, actions, and triggers. Agents communicate through events and can be triggered by crons, events, or directives.

## What is the event bus?

The event bus is how agents communicate. Agents publish events (e.g., `sentinel:alert`) and subscribe to events from other agents. This enables cross-department coordination without direct coupling.

## What are approval gates?

Approval gates are safety controls that require human approval before agents execute certain actions. This prevents autonomous agents from taking destructive actions without oversight.

## Can I add my own agents?

Yes. Create a new YAML config in the appropriate department directory, define system prompts, skills, actions, and triggers. The framework discovers and loads agents automatically.

## Do I need coding experience?

Basic familiarity with YAML configuration and command-line tools is helpful. You don't need to write code to configure agents, but custom skills and prompts are written in Markdown.

## Does YCLAW have a token?

No. YCLAW is a software framework, not a blockchain or token project.

## Is YCLAW a blockchain/DeFi/Solana project?

No. YCLAW is infrastructure for orchestrating AI agent teams. It has no blockchain components, no tokens, and no on-chain mechanics.

## Where can I get help?

- **Discord:** Join our community for real-time help
- **Telegram:** Community discussion
- **GitHub Issues:** Bug reports and feature requests
- **Docs:** Check the repository documentation

## How do I report a bug?

Open a GitHub issue with: description of the problem, steps to reproduce, expected vs actual behavior, and your environment details (OS, Node version, model provider).

## How do I contribute?

Fork the repo, make your changes, and open a pull request. See CONTRIBUTING.md for guidelines.

---

**Status:** Active FAQ. Keep updated as the framework evolves.
