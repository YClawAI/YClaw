# Infrastructure Cost Tracking

> Monitor and report infrastructure spend across all YClaw services.
> Complement to ai-usage-tracking.md — together these cover total platform burn rate.

## Infrastructure Inventory

| Service | Provider | What It Runs | Billing API | Status |
|---------|----------|-------------|------------|--------|
| **ECS Fargate** | AWS | Agent containers | AWS Cost Explorer | ⚠️ Needs IAM permission |
| **RDS PostgreSQL** | AWS | Agent memory (pgvector) | AWS Cost Explorer | ⚠️ Needs IAM permission |
| **ALB** | AWS | Load balancer for agent API | AWS Cost Explorer | ⚠️ Needs IAM permission |
| **NAT Gateway** | AWS | Outbound internet for ECS | AWS Cost Explorer | ⚠️ Needs IAM permission |
| **ECR** | AWS | Docker image storage | AWS Cost Explorer | ⚠️ Needs IAM permission |
| **Secrets Manager** | AWS | API keys + certs | AWS Cost Explorer | ⚠️ Needs IAM permission |
| **WAF** | AWS | Webhook protection | AWS Cost Explorer | ⚠️ Needs IAM permission |
| **MongoDB Atlas** | MongoDB Inc | Agent memory store | Atlas Org API | ❌ Needs API keys |
| **Redis Cloud** | Redis Ltd | Event bus | Redis Cloud API | ❌ Needs API keys |
| **Alchemy** | Alchemy | EVM RPC | Manual only | — |
| **Helius** | Helius | Solana RPC | Manual only | — |

## What's Needed to Activate

### AWS Cost Explorer (aws_cost_monthly data source)

Add `ce:GetCostAndUsage` and `ce:GetCostForecast` permissions to the readonly IAM user
used by the Treasurer agent. No new secrets needed — uses existing AWS credentials.

### MongoDB Atlas (mongodb_atlas_billing data source)

Create an API key with **Org Billing Viewer** role in the Atlas org settings, then add to secrets:
- `MONGODB_ATLAS_PUBLIC_KEY`
- `MONGODB_ATLAS_PRIVATE_KEY`
- `MONGODB_ATLAS_ORG_ID`

### Redis Cloud (redis_cloud_billing data source)

Generate API Key + Secret Key from the Redis Cloud console, then add to secrets:
- `REDIS_CLOUD_API_KEY`
- `REDIS_CLOUD_SECRET_KEY`

## Cost Report Template

```
🏗️ Infrastructure Costs — [DATE]

AWS (last 30 days):
• ECS Fargate: $[amount]
• RDS: $[amount]
• ALB + NAT: $[amount]
• Other: $[amount]
• Total AWS: $[total]

MongoDB Atlas: $[amount]/month
Redis Cloud: $[amount]/month

Manual (last updated [DATE]):
• Alchemy (EVM RPC): $[amount]/month
• Helius (Solana RPC): $[amount]/month

Total Infra: $[total]/month
```

## Alert Thresholds

- **AWS monthly > $500** → flag in weekly report
- **AWS monthly > $1,000** → immediate Discord alert + escalate to team lead
- **MongoDB Atlas > $100/month** → flag in report
- **Redis Cloud > $50/month** → flag in report
- **Any service with >50% MoM increase** → immediate alert

## Weekly Spend Report Integration

Include infra costs in the `weekly_spend` task:
1. Pull `aws_cost_monthly` (automated when IAM permission added)
2. Pull `mongodb_atlas_billing` (automated when keys added)
3. Pull `redis_cloud_billing` (automated when keys added)
4. Note last-known Alchemy/Helius costs manually
5. Add to burn rate calculation alongside AI costs

## Burn Rate Calculation

Total Monthly Burn = AI Costs + Infra Costs + Other

```
AI:    OpenRouter + Anthropic + OpenAI + xAI + Gemini
Infra: AWS + MongoDB Atlas + Redis Cloud + Alchemy + Helius
Other: GitHub Pro, Discord, other SaaS
```

Runway = Treasury Balance / Monthly Burn Rate
Flag if Runway < 6 months.
