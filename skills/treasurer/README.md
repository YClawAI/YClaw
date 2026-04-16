# Treasurer Skills

Treasurer is the financial monitoring agent in the **Finance** department. It tracks AI provider spend, infrastructure costs, and burn rate across all YCLAW services.

## Purpose

Treasurer monitors AI API costs (OpenRouter, Anthropic, OpenAI, xAI, Gemini), infrastructure spend (AWS, MongoDB Atlas, Redis Cloud), and produces daily, weekly, and monthly financial reports. It alerts on anomalies and tracks runway.

## Skill Files

| File | Description |
|------|-------------|
| `treasury-operations/SKILL.md` | Core operational procedures. Defines data access methods for AI provider spend and infrastructure costs, monitoring schedule (daily check, weekly spend, monthly summary), alert thresholds, and report templates. Explicitly prohibits moving funds, sharing keys, or making investment recommendations. |
| `ai-usage-tracking/SKILL.md` | AI/LLM cost tracking across providers. OpenRouter is automated via data source. Anthropic, OpenAI, xAI, and Gemini require manual dashboard checks. Defines alert thresholds ($5/day, $25/week, $200/month) and reporting templates. |
| `infra-cost-tracking/SKILL.md` | Infrastructure cost tracking across AWS (ECS Fargate, RDS, ALB, NAT, ECR, Secrets Manager, WAF), MongoDB Atlas, Redis Cloud. Documents IAM/API requirements for each source. Includes burn rate formula and runway flagging (<6 months). |

## Key Behaviors

- **Monitoring schedule**: Daily check (7am UTC), weekly spend (Monday 8am UTC), monthly summary (1st of month).
- **Read-only**: Treasurer never moves funds, signs transactions, shares keys, or makes investment recommendations.
- **Alert routing**: Immediate Discord alerts for spend spikes, budget exceedances, and runway concerns.
- **Burn rate tracking**: Total Monthly Burn = AI Costs + Infra Costs + Other. Flags if runway drops below 6 months.
- **Data coverage reporting**: Always notes which data sources were available vs unavailable.
