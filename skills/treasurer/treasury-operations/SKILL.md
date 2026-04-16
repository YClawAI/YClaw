# Treasury Operations

> Loaded by the Treasurer agent. Defines data sources, monitoring procedures,
> and operational rules for treasury and cost monitoring.

---

## Data Access

### AI Provider Spend
- **OpenRouter:** Automated via `openrouter_usage` data source (daily, weekly, monthly spend)
- **Anthropic:** Manual — check https://console.anthropic.com/settings/billing
- **OpenAI:** Manual — check https://platform.openai.com/usage
- **xAI/Grok:** Manual — check https://console.x.ai/team/billing
- **Google/Gemini:** Manual — check https://console.cloud.google.com/billing

### Infrastructure Costs
- **AWS Cost Explorer:** Via `aws_cost_monthly` data source (requires IAM `ce:GetCostAndUsage`)
- **MongoDB Atlas:** Via `mongodb_atlas_billing` data source (requires API keys)
- **Redis Cloud:** Via `redis_cloud_billing` data source (requires API keys)

### Future Data Sources (Not Yet Active)
- **LiteLLM:** Via `litellm_spend` — requires LiteLLM proxy (not active in YCLAW)
- **Blockchain wallets:** Can be configured via `solana_rpc` or `api` data source types when needed
- **Banking:** Can be configured via `teller` data source type when needed

---

## Monitoring Schedule

| Task | Frequency | What to Check |
|------|-----------|---------------|
| `treasury_check` | Daily 7am UTC | AI spend across providers, infra costs, flag anomalies |
| `weekly_spend` | Monday 8am UTC | Net spend breakdown by category, burn rate trend, budget variance |
| `monthly_summary` | 1st of month 8am UTC | Full financial report: all costs, burn rate, runway estimate |

## Alert Thresholds

### AI Spend
- **OpenRouter daily > $5.00** → flag in report (agent fleet running hot)
- **OpenRouter weekly > $25.00** → immediate Discord alert
- **Total estimated monthly AI > $200** → escalate to team lead

### Infrastructure
- **AWS monthly > $500** → flag in weekly report
- **AWS monthly > $1,000** → immediate Discord alert + escalate
- **MongoDB Atlas > $100/month** → flag in report
- **Redis Cloud > $50/month** → flag in report
- **Any service +50% MoM increase** → immediate Discord alert

### General
- **Monthly burn rate exceeds budget** → flag in weekly report
- **Runway < 6 months** → immediate Discord alert + escalate

## Reporting Format

```
💰 Financial Report — [DATE]

AI Spend (last 30 days):
• OpenRouter (automated): $[amount]
• Anthropic (manual, last updated [date]): $[amount]
• OpenAI (manual): $[amount]
• Other: $[amount]
• Total AI: $[total]/month

Infrastructure (last 30 days):
• AWS: $[total]
• MongoDB Atlas: $[amount]
• Redis Cloud: $[amount]
• Total Infra: $[total]/month

Total Monthly Burn: $[total]
Runway: [months] at current burn

Data Source Coverage: [X]/[Y] sources active
⚠️ Estimates may be incomplete — [list unavailable sources]
```

## What You Cannot Do

- Never move funds or sign transactions
- Never share wallet private keys or seed phrases
- Never make investment recommendations
- Never predict token prices
- Report numbers factually — no editorializing
- Always note which data sources were unavailable
