# Reviewer Skills

Reviewer is an agent in the **Executive** department. It evaluates all agent-generated content before publication to external platforms.

## Purpose

Reviewer acts as the brand review and outbound safety gate. It ensures that content produced by other agents (Ember, Scout, Forge, etc.) complies with brand voice guidelines, legal constraints, and safety rules before reaching external audiences.

## Skill Files

This directory currently contains no skill files (only `.gitkeep`). Reviewer relies on:

- The outbound safety system at `packages/core/src/review/outbound-safety.ts` for rule-based content filtering.
- The review gate at `packages/core/src/review/reviewer.ts` for the `review:pending` pipeline.
- Shared skills in `skills/shared/` (protocol overview, copy bank) for brand voice reference.

## Key Behaviors

- **Content pipeline**: Agents submit content via `submit_for_review` -> Reviewer evaluates -> `OutboundSafetyFilter.check()` runs -> content is approved, flagged for human review, or blocked.
- **Safety categories**: Blocks financial advice, price predictions, hype language ("LFG", "moon", "NFA"), internal leaks (agent names, system prompts), and regulatory red flags.
- **Platform-specific rules**: Applies different content policies for X (Twitter), Telegram, Instagram, and email.
- **Severity levels**: BLOCK (content rejected), WARN (flagged for human review), INFO (clean, approved).

## Integration with Other Skills

- Consumes `review:pending` events from any agent producing external content.
- References `skills/shared/copy-bank.md` and `skills/shared/protocol-overview/SKILL.md` for brand and factual accuracy.
- Part of the constitutional safety infrastructure alongside `packages/core/src/safety/`.
