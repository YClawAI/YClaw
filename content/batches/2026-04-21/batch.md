# Content Batch — Week of 2026-04-21

**Directive:** Resume X content cadence. Target 5-7 posts/week.  
**Source:** strategist:ember_directive (content_cadence, P1)  
**Status:** All approved. Queued pending Twitter credential restoration (Issue #127).  
**Approved by:** Reviewer (auto-review gate)

---

## Post 1 — Dev Velocity
**Review ID:** a1c16a4e-01f0-43e7-b1e6-51691d21ccac | **Score:** 92 | **Angle:** autonomous dev pipeline output

> YClaw's agent org closed 15 GitHub issues last week.
>
> Code review automation. Dynamic project registration. RTK query fixes. Tech debt cleanup.
>
> Autonomous development pipeline. No humans in the loop.
>
> → https://github.com/YClawAI/YClaw

---

## Post 2 — Org vs Runner Positioning
**Review ID:** d09c457a-68f5-4025-8e58-16d42611a721 | **Score:** 95 | **Angle:** agent org infrastructure differentiation

> Most agent frameworks give you a runner.
>
> YClaw gives you an org.
>
> Departments. Chains of command. Approval gates. Persistent memory across executions. An event bus that agents use to coordinate without a human routing messages between them.
>
> The difference between a bot and an organization is infrastructure.
>
> → https://github.com/YClawAI/YClaw
> → https://yclaw.ai

---

## Post 3 — Self-Modifying Agents with Governance
**Review ID:** e9a4a9a2-fc0b-4b4a-9354-fecdb1bd2e29 | **Score:** 92 | **Angle:** self-modification + safety rails

> YClaw agents can rewrite their own system prompts, update their schedules, and switch LLM providers mid-run.
>
> Every change is logged. Prompt edits go through a reviewer. Config writes are auto-approved with an audit trail.
>
> Self-modification without governance is just chaos. YClaw ships both.
>
> → https://github.com/YClawAI/YClaw

---

## Post 4 — Autonomous Dev Pipeline (How It Works)
**Review ID:** 1740dd83-4275-42ac-8e83-992cba024311 | **Score:** 92 | **Angle:** pipeline mechanics walkthrough

> How YClaw's autonomous dev pipeline works:
>
> GitHub issue opens → Architect triages and plans → AO executes the code change → CI runs → PR auto-merges → Architect audits post-merge
>
> No human in the loop for routine work. Human oversight where it matters — at the approval gates you configure.
>
> The pipeline ran 15 issues last week. It'll run again this week.
>
> → https://github.com/YClawAI/YClaw

---

## Post 5 — Model-Agnostic / No Lock-In
**Review ID:** e427d220-8b13-4778-8412-541cb79920ac | **Score:** 92 | **Angle:** model-agnostic positioning vs vendor lock-in

> The lock-in problem with AI agent platforms isn't the features. It's the model dependency.
>
> If your agent org only runs on one provider, you're one API change away from a rebuild.
>
> YClaw is model-agnostic by design. Anthropic, OpenAI, Google, local models — swap without touching your agent configs.
>
> AGPL-3.0. Self-hosted. You own the infrastructure.
>
> → https://github.com/YClawAI/YClaw
> → https://discord.com/invite/HqFDg4UHXx

---

## Post 6 — Thread: What It Takes to Run an AI Agent Org
**Review ID:** 1afcb5f1-d8f3-4686-943c-e7e20248aeff | **Score:** 92 | **Angle:** technical deep dive thread (5 tweets)

**Tweet 1:**
> Thread: What it actually takes to run an AI agent organization (not a demo)
>
> Running agents in production before open-sourcing anything taught us what actually breaks.
>
> It's not the models. It's the coordination layer.

**Tweet 2:**
> Agents need to talk to each other without a human routing messages. YClaw uses Redis Streams — HMAC-signed events that agents publish and subscribe to by role.
>
> Marketing publishes content_ready. Reviewer picks it up. Approved event fires. Ember publishes.
>
> No human in that loop.

**Tweet 3:**
> Agents need memory that survives between runs. Not conversation context — operational memory. Configuration state. Approval history. Event logs.
>
> MongoDB-backed. Per-agent. Persistent.

**Tweet 4:**
> Approval gates need to be configurable, not hardcoded. Some actions auto-approve. Some require Reviewer. Some require a human.
>
> The gate policy lives in config. You set it. Agents respect it.

**Tweet 5:**
> The whole thing needs to run on your infrastructure.
>
> AGPL-3.0. Docker Compose or AWS Terraform. Your data, your control.
>
> → https://github.com/YClawAI/YClaw
> → https://discord.com/invite/HqFDg4UHXx

---

## Post 7 — Weekend Community Post
**Review ID:** e7cb9657-db52-4bcb-88c3-1377321286d0 | **Score:** 92 | **Angle:** developer invite, community-focused

> If you're building with AI agents and want to see how a real multi-agent org is structured — the YClaw repo is public.
>
> 6 departments. Event-driven coordination. Approval gates. Self-hosted.
>
> Built on what ran in production for over a year before we open-sourced it.
>
> → https://github.com/YClawAI/YClaw
> → https://discord.com/invite/HqFDg4UHXx

---

## Publishing Schedule (Queued)

| Post | Day | Time (UTC) | Status |
|------|-----|------------|--------|
| Post 1 (Dev velocity) | Mon Apr 21 | 14:00 | Queued — Twitter 401 |
| Post 2 (Org vs runner) | Tue Apr 22 | 14:00 | Queued — Twitter 401 |
| Post 3 (Self-modifying) | Wed Apr 23 | 14:00 | Queued — Twitter 401 |
| Post 4 (Pipeline how-to) | Thu Apr 24 | 14:00 | Queued — Twitter 401 |
| Post 5 (No lock-in) | Fri Apr 25 | 14:00 | Queued — Twitter 401 |
| Post 6 (Thread) | Midweek | 16:30 | Queued — Twitter 401 |
| Post 7 (Weekend) | Sat/Sun | 15:00 | Queued — Twitter 401 |

**Blocker:** Twitter/X credentials returning 401. Issue #127 closed on GitHub but env not yet rotated.  
Human action required: rotate Twitter API credentials in environment config.
