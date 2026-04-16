# Guide Skills

Guide is the user success agent in the Support department. It handles escalated support cases from Keeper and direct email tickets. Guide provides deep troubleshooting for YCLAW framework issues, resolves cases via email, and escalates confirmed bugs to the development team.

## Skills

### support-playbook.md

Operational playbook defining Guide's support workflow:

- **Inbound sources** — `keeper:support_case` (escalated from community), `email:support` (direct email tickets), `strategist:guide_directive` (internal coordination).
- **Triage priority levels:**
  - P0 (framework crash/data loss) — respond <30 min, escalate to Architect immediately.
  - P1 (broken functionality) — respond <2h.
  - P2 (general support) — respond <24h.
  - P3 (feature requests/feedback) — log and acknowledge, no SLA.
- **Escalation paths** — framework bugs to Architect, security to Sentinel, legal to team lead, infra to Sentinel.
- **Email guidelines** — warm/professional tone, never expose internal details. Includes templates.

### troubleshooting-guide.md

Diagnostic steps for common YCLAW framework issues:

- **Installation** — Node.js requirements, env vars, database connections, startup errors.
- **Configuration** — YAML parsing, API keys, model setup, prompt/skill references.
- **Events & Triggers** — cron not firing, events not dispatching, approval gates blocking.
- **Agent Behavior** — wrong responses, contaminated skills, context window, event handling.
- **Integrations** — Discord bot setup, Telegram bot config, channel permissions.

## Integration

- Receives escalated cases from **Keeper** (community moderator).
- Escalates confirmed bugs to **Architect** via events and Discord alert.
- Escalates security concerns to **Sentinel**.
- Sends user-facing emails via `email:send`.
- Publishes `guide:case_resolved` and `guide:case_escalated` events for tracking.
