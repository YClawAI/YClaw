# Treasurer Skills

Treasurer is the financial monitoring agent in the **Finance** department. It tracks treasury balances, infrastructure costs, AI spend, and burn rate across all YClaw services.

## Purpose

Treasurer monitors on-chain wallets (Solana, EVM), bank accounts (via Teller.io banking API), AI provider spend, and infrastructure costs. It produces daily, weekly, and monthly financial reports, and alerts on anomalies.

## Skill Files

| File | Description |
|------|-------------|
| `treasury-operations/SKILL.md` | Core operational procedures. Defines data access methods (Helius RPC for Solana, Alchemy for EVM), key RPC methods for balance and transaction checks, monitoring schedule (daily treasury check, weekly spend, monthly summary), alert thresholds (SOL < 5, USDC drops > 20%, unknown outbound > $1K), and report templates. Also covers banking access via Teller.io. Explicitly prohibits moving funds, sharing keys, or making investment recommendations. |
| `treasury-protocol-reference/SKILL.md` | Quick reference for YClaw on-chain programs (Tokens, Voter, Lend, Payments, Mayflower) with addresses. Lists key metrics to track (TVL, active wallets, creator tokens, 24h volume) and API endpoints for when the platform goes live. Includes metric reporting rules (timestamps, rounding, no editorializing). |
| `ai-usage-tracking/SKILL.md` | AI/LLM cost tracking across providers. OpenRouter usage is automated via the `openrouter_usage` data source. Anthropic, OpenAI, xAI/Grok, and Google/Gemini require manual dashboard checks or upgraded API keys. Defines alert thresholds (daily > $5, weekly > $25, monthly > $200) and a reporting template. |
| `infra-cost-tracking/SKILL.md` | Infrastructure cost tracking across AWS (ECS Fargate, RDS, ALB, NAT, ECR, Secrets Manager, WAF), MongoDB Atlas, Redis Cloud, Alchemy, and Helius. Documents what IAM permissions and API keys are needed to activate each data source. Defines alert thresholds (AWS > $500/month flag, > $1K escalate; any service +50% MoM immediate alert). Includes burn rate calculation formula and runway flagging (< 6 months). |

## Key Behaviors

- **Monitoring schedule**: Daily treasury check (7am UTC), weekly spend report (Monday 8am UTC), monthly summary (1st of month 8am UTC).
- **Read-only**: Treasurer never moves funds, signs transactions, shares keys, or makes investment recommendations.
- **Alert routing**: Immediate Slack alerts for low SOL, large USDC drops, unknown large outbound transactions, and checking balance below $10K. Weekly report flags for budget exceedances.
- **Burn rate tracking**: Total Monthly Burn = AI Costs + Infra Costs + Other. Flags if runway drops below 6 months.

## Integration with Other Skills

- References `skills/shared/protocol-overview/SKILL.md` for on-chain program details (via `treasury-protocol-reference`).
- AI usage data feeds into the `weekly_spend` task alongside infrastructure costs.
- Alerts post to internal Slack channels and escalate to team lead when thresholds are exceeded.
