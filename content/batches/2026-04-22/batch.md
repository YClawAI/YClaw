# Content Batch — 2026-04-22

**Directive:** Prepare additional content for publishing once Twitter credentials are rotated (Issue #178). Focus on YClaw as open-source agent orchestration harness.
**Source:** strategist:ember_directive (content_preparation, P1)
**Status:** All approved. Queued pending Twitter credential restoration (Issue #178).
**Approved by:** Reviewer (auto-review gate)

---

## Post 1 — HMAC-Signed Event Bus Security
**Review ID:** 6f279040-3f20-45fa-b67d-a32079a9eb6b | **Score:** 92 | **Angle:** security architecture / event bus

> Most agent security is an afterthought.
>
> YClaw's event bus signs every message with HMAC-SHA256. Agents can only publish events they're authorized for. Replay attacks are blocked. Schema validation runs on every event.
>
> Security isn't a layer on top. It's in the coordination protocol itself.
>
> → https://github.com/YClawAI/YClaw

---

## Post 2 — Configurable Approval Gates
**Review ID:** b8d242ac-c6f5-4139-92a3-b0c6cf531c72 | **Score:** 92 | **Angle:** approval gate configurability

> Approval gates in most agent systems are binary: everything or nothing.
>
> YClaw's gate policy lives in config. You decide which actions auto-approve, which go to a Reviewer agent, and which require a human.
>
> Content publishing: Reviewer gates it. Deploy execution: human approves. Memory writes: auto-approved with an audit trail.
>
> The policy is yours. The infrastructure enforces it.
>
> → https://github.com/YClawAI/YClaw
> → https://yclaw.ai

---

## Post 3 — Self-Hosted Data Sovereignty
**Review ID:** 0b8db11e-376a-4960-9871-438dd6a3525a | **Score:** 95 | **Angle:** self-hosted / data ownership

> Your agent org's data should be on your infrastructure. Not a vendor's.
>
> YClaw runs on Docker Compose or AWS Terraform. MongoDB for agent memory. Redis for the event bus. Your cluster, your data, your control.
>
> Self-hosted isn't a constraint. It's a design choice.
>
> → https://github.com/YClawAI/YClaw

---

## Post 4 — Installer / Quick Start
**Review ID:** 67b49538-a8a4-41a7-87b6-da7320ce94d0 | **Score:** 92 | **Angle:** installer UX / getting started

> YClaw is designed to get you from zero to running agents in under an hour.
>
> yclaw init — guided setup wizard, 3 presets
> yclaw doctor — preflight checks before anything deploys
> yclaw deploy — Docker Compose or Terraform, your choice
>
> The installer handles the infrastructure. You configure the org.
>
> → https://github.com/YClawAI/YClaw
> → https://discord.com/invite/HqFDg4UHXx

---

## Post 5 — AGPL-3.0 Open Source Philosophy
**Review ID:** ed84afb0-6c87-418f-aacd-244200252e12 | **Score:** 95 | **Angle:** open source as philosophy

> AGPL-3.0 is a deliberate choice.
>
> Agent infrastructure shouldn't be a walled garden. If you build on YClaw, you can see every line of code running your agents. You can fork it. You can run it on air-gapped infrastructure if that's what your use case requires.
>
> Open source as a philosophy, not a marketing tactic.
>
> → https://github.com/YClawAI/YClaw

---

## Post 6 — Multi-Operator Cross-Org Coordination
**Review ID:** 12419474-6f4f-4594-8d6f-65404bee2cce | **Score:** 92 | **Angle:** multi-operator model

> Most multi-agent platforms assume all agents belong to one organization.
>
> YClaw's multi-operator model lets you invite external agents into your orchestration layer. Their agent, their model, their team — working alongside yours inside the same event-driven structure.
>
> Cross-org agent coordination without rebuilding your infrastructure.
>
> → https://github.com/YClawAI/YClaw
> → https://yclaw.ai

---

## Post 7 — Department Structure as Security Primitive
**Review ID:** 75da5b96-7360-41ad-afcc-4f81425826c3 | **Score:** 92 | **Angle:** department structure / RBAC

> The department structure in YClaw isn't cosmetic.
>
> Each department has a defined scope, a chain of command, and agents that can only publish events they're authorized for. Marketing can't trigger deploys. Development can't publish external content without review.
>
> Organizational structure as a security primitive.
>
> → https://github.com/YClawAI/YClaw

---

## Combined Queue Status

### This batch (2026-04-22): 7 posts approved
| Post | Review ID | Score |
|------|-----------|-------|
| HMAC event bus | 6f279040 | 92 |
| Approval gates | b8d242ac | 92 |
| Self-hosted | 0b8db11e | 95 |
| Installer | 67b49538 | 92 |
| AGPL-3.0 | ed84afb0 | 95 |
| Multi-operator | 12419474 | 92 |
| Dept structure | 75da5b96 | 92 |

### Prior approved queue (still pending):
- 2026-04-21 batch: 7 posts (scores 92-95, branch agent/ember/content-batch-2026-04-21)
- afternoon_engagement 2026-04-21 "35 agents in a markdown folder" (review b10ff095, score 94)
- afternoon_engagement 2026-04-21 "persistent agent memory" (review 4e10109a, score 93)
- publish_with_asset "social-network-16x9" tweet (review 5fa3ade4, score 94) — NOTE: asset URL may be expired
- afternoon_engagement 2026-04-16 "org charts vs org infrastructure" (review 9c782c9c, score 96)
- afternoon_engagement 2026-04-17 "Agent Factory / Mizuho" (review d8b2c966, score 92)

**Total queued: ~18 approved posts**

**Blocker:** Twitter/X credentials returning 401. Issue #178 open and tracking.
Human action required: rotate Twitter API credentials in environment config.
