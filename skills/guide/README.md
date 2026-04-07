# Guide Skills

Guide is the user success agent in the Support department. It handles escalated support cases from Keeper and direct email tickets. Guide provides deep troubleshooting, resolves issues via email (AWS SES), and escalates unresolvable cases to the Development team.

## Skills

### support-playbook

Operational playbook defining Guide's support workflow:

- **Inbound sources** -- `keeper:support_case` (escalated from community), `email:support` (direct email tickets), `strategist:guide_directive` (internal coordination).
- **Triage priority levels:**
  - P0 (funds at risk) -- respond in < 30 min, escalate to Builder immediately.
  - P1 (broken functionality) -- respond in < 2h.
  - P2 (general support) -- respond in < 24h.
  - P3 (feature requests/feedback) -- log and acknowledge, no SLA.
- **Resolution steps** -- acknowledge, diagnose, resolve or escalate, follow up.
- **Escalation paths** -- smart contract bugs to Builder + Architect, extension bugs to Builder, security to Sentinel, legal/compliance to team lead (DM only), infrastructure to Sentinel.
- **Email guidelines** -- from the support email address, warm/professional tone, never expose internal system details. Includes acknowledgment and resolution email templates.
- **Case logging** -- post summary to the internal support channel with anonymized user identifier, issue type, resolution, and time to resolve.

**File:** `support-playbook.md`

### troubleshooting-guide

Diagnostic steps for common escalated support issues:

- **Chrome Extension** -- install failures (browser compatibility, conflicting extensions), watch time not recording (creator verification, ad blocker interference), "Not Connected" state (wallet reconnection, clear storage).
- **Transactions** -- failed transactions (insufficient SOL, network congestion, slippage, stale price data), claim not working (`accrue_position_rewards` must precede `claim_staker_rewards`), staking/unstaking errors (lock period, approvals).
- **Wallets** -- connection failures (Phantom, Magic Eden, Backpack supported), wrong network (Solana mainnet only, no EVM wallets).
- **Accounts** -- positions tied to wallet address not email, no cross-wallet position merging (on-chain limitation).

**Escalation to Builder requires:** wallet address, browser + OS + extension version, steps to reproduce, exact error messages, and affected platform.

**File:** `troubleshooting-guide.md`

## Triggers

| Event | Task |
|---|---|
| `keeper:support_case` | `handle_support` |
| `guide:directive` | `handle_directive` |
| Cron (daily) | `daily_standup` |

## Integration

- Receives escalated cases from **Keeper** (community moderator).
- Escalates confirmed bugs to **Builder** via events and internal alert.
- Escalates security concerns to **Sentinel** via internal security channel.
- Sends user-facing emails via `email:send` (AWS SES).
- Publishes `guide:case_resolved` and `guide:case_escalated` events for tracking.
- Does not moderate community channels (that is Keeper's role) or post to public Telegram.
