# AI Usage Tracking

> Monitor and report AI/LLM API spend across all YClaw services.

## AI Service Inventory

| Provider | Used By | Billing Model | Data Source |
|----------|---------|--------------|-------------|
| **OpenRouter** | YClaw Agents | Pay-per-token | `openrouter_usage` ✅ LIVE |
| **Anthropic** | Claude-based services | Pay-per-token | ❌ Needs admin API key |
| **OpenAI** | Codex, embeddings | Pay-per-token | ❌ Needs `api.usage.read` scope |
| **xAI/Grok** | Research, media gen | Pay-per-token | ❌ No usage API (manual only) |
| **Google/Gemini** | Veo video gen | Pay-per-token | ❌ Needs GCP Billing API scope |

## Available Data: OpenRouter

The `openrouter_usage` data source returns:

```json
{
  "usage": 3.06,           // Total all-time spend ($)
  "usage_daily": 0.11,     // Today's spend ($)
  "usage_weekly": 2.73,    // Last 7 days ($)
  "usage_monthly": 3.06,   // Last 30 days ($)
  "limit": null,           // Spending limit (null = unlimited)
  "limit_remaining": null,
  "is_free_tier": false
}
```

## Unavailable Data (Manual Collection Required)

For services without programmatic usage APIs, check provider dashboards:

- **Anthropic:** https://console.anthropic.com/settings/billing
- **OpenAI:** https://platform.openai.com/usage
- **xAI:** https://console.x.ai/team/billing
- **Google Cloud:** https://console.cloud.google.com/billing

## Reporting Template

```
🤖 AI Usage Report — [DATE]

Automated:
• OpenRouter (YClaw Agents): $[daily] today / $[weekly] this week / $[monthly] this month

Manual (last updated [DATE]):
• Anthropic: $[amount]/month
• OpenAI (embeddings): $[amount]/month
• xAI/Grok (research): $[amount]/month
• Google/Gemini (video gen): $[amount]/month

Total Estimated AI Spend: $[total]/month
Burn Rate Trend: [up/down/stable] vs last month
```

## Weekly Spend Report Integration

Include AI usage in the `weekly_spend` task:
1. Pull OpenRouter usage from data source (automated)
2. Note last-known values for other providers
3. Flag if any provider spend exceeds thresholds
4. Estimate monthly burn rate

## Alert Thresholds

- **OpenRouter daily > $5.00** → flag in report (agent fleet running hot)
- **OpenRouter weekly > $25.00** → immediate Discord alert
- **Total estimated monthly > $200** → escalate to team lead

## Future Improvements

When API keys are upgraded, add these data sources:
1. `anthropic_usage` — requires admin API key from console.anthropic.com
2. `openai_usage` — requires API key with `api.usage.read` scope
3. `gcp_billing` — requires Cloud Billing API access
4. xAI — no known programmatic API; monitor manually
