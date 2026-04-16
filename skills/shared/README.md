# Shared Skills

Shared skills are available to all agents in the system. Per the skills governance rules, only patterns that genuinely help 3+ agents belong here.

## Purpose

This directory contains universal knowledge assets (protocol reference, copy bank, FAQ) and foundational behavioral skills (First Principles, Karpathy guidelines) that apply across departments.

## Skill Files

### Protocol & Brand Knowledge

| File | Description |
|------|-------------|
| `protocol-overview/SKILL.md` | Authoritative technical description of YCLAW — the open-source AI agent orchestration framework. Covers department structure, event-bus coordination, approval gates, agent memory, model-agnostic LLM integration, and self-hosted deployment. The single source of truth for all framework claims. |
| `copy-bank.md` | Pre-approved copy for YCLAW external surfaces (landing page, README, social posts, notifications, error messages, empty states, SEO). Messaging follows `prompts/brand-voice.md`. |
| `faq-bank.md` | Central FAQ knowledge base for YCLAW — what it is, how to deploy, how agents coordinate, extensibility, open-source model, and operational troubleshooting. |

### Behavioral Skills (Always Active)

| File | Description |
|------|-------------|
| `first-principles/SKILL.md` | Decompose problems to fundamental truths before solving. Four principles: (1) Decompose before solving, (2) Question every assumption, (3) Build up from fundamentals, (4) Validate against reality. Prevents reasoning by analogy and cargo-culting. |
| `karpathy-guidelines/SKILL.md` | Behavioral guidelines to reduce common LLM coding mistakes. Four principles: (1) Think before coding, (2) Simplicity first, (3) Surgical changes, (4) Goal-driven execution. |

### Learning & Tooling Skills (On-Demand)

| File | Description |
|------|-------------|
| `claudeception/SKILL.md` | Post-session knowledge extraction system. After completing tasks, extracts non-obvious discoveries and updates repo knowledge (CLAUDE.md) with reusable patterns. Triggers on non-obvious solutions, project-specific patterns, tool integration knowledge, error resolution, and workflow optimizations. |
| `rlm/SKILL.md` | Recursive Language Model pattern for processing large codebases (100+ files) without context rot. Uses parallel map-reduce: index and filter files, split into atomic sub-tasks, process in parallel (3-5 agents), then reduce and synthesize results. |
| `skillforge/SKILL.md` | Skill router and creator. Routes inputs to existing skills (>=80% match), improves existing skills (50-79%), or creates new skills (<50%). Defines the standard skill directory structure (`SKILL.md`, `references/`, `scripts/`). |
| `vitest-esm-class-mock/SKILL.md` | Pattern for mocking class constructors in vitest v4 with ESM modules. Solves the problem where `vi.fn().mockImplementation()` loses its implementation after `vi.clearAllMocks()`. Uses `vi.hoisted()` + real class in `vi.mock()` factory. Includes anti-pattern warning and verification steps. |

### Governance Skills (On-Demand)

| File | Description |
|------|-------------|
| `contamination-check/SKILL.md` | Detect and prevent product-specific terminology contamination across `skills/` and `prompts/`. Run after bulk content updates, skill imports, or agent config changes. Includes layered-exclusion grep patterns, prevention rules, and quarantine response procedure. Documents the P0 cleanup incident that necessitated this skill. |

## Governance

Skills follow a four-tier trust system:

| Tier | Activation |
|------|------------|
| `builtin` | Always allowed |
| `trusted` | Always allowed |
| `community` | Allowed if scan passes; auto-promotes to `trusted` after 5 uses |
| `draft` | Blocked until human promotion |

See `skills/README.md` for the full directory structure and governance rules.
