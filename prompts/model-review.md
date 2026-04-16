# Model Review — Monthly Evaluation Task

**Task:** `model_review`
**Schedule:** First Monday of each month, 14:00 UTC (10:00 AM AST)

## Objective

Evaluate current AI model assignments across all agents AND per-task overrides. Produce actionable recommendations with specific YAML changes. Base recommendations on actual usage data, not just benchmarks.

## Instructions

### 1. Gather Usage Data

Before researching models, collect actual data:
- Review execution records from the past month (check MongoDB or audit logs)
- For each agent: total executions, total tokens (input/output), cache hit rates
- For each task type: average tokens per execution, frequency, success rate
- Identify the top 5 most expensive agent+task combinations
- Check Treasurer's latest spend report in [your-finance-channel]

### 2. Research Current Model Landscape

Survey the latest available models from:
- **Anthropic:** Claude model family (Haiku, Sonnet, Opus) — versions, capabilities, pricing
- **OpenAI:** GPT model family — versions, capabilities, pricing
- **Open-source via OpenRouter:** Leading models (Llama, Mistral, DeepSeek, Qwen) — capabilities, pricing
- **xAI:** Grok models — capabilities, pricing

For each model, capture:
- Context window size
- Pricing (input/output per million tokens, cache pricing if available)
- Key strengths (reasoning, coding, speed, instruction-following)
- API stability and availability

### 3. Evaluate Agent-Level Assignments

Review current model for each agent against their actual workload:

| Tier | Agents | Needs |
|---|---|---|
| **Deep Reasoning** | Strategist (strategic tasks), Architect | Complex planning, code review, nuanced judgment |
| **Code Generation** | Architect (codegen tasks) | Strong coding, tool use, large context |
| **Brand & Content** | Reviewer, Ember, Scout | Instruction-following, tone consistency, creativity |
| **Operational** | Sentinel, Keeper, Librarian, Treasurer | Reliable, structured output, cost-efficient |
| **Support** | Designer, Forge, Guide | Task-specific, moderate capability needed |

### 4. Evaluate Per-Task Overrides (NEW)

This is the key differentiator. For each agent, analyze which tasks could use a cheaper model:

**Tasks that almost always work on cheaper models:**
- Daily standups → Sonnet or Haiku
- Heartbeat checks → Sonnet or Haiku
- Self-reflection (Claudeception) → Sonnet
- Simple event acknowledgments → Haiku

**Tasks that need the agent's full model:**
- PR reviews (Architect) → keep Opus
- Weekly directives (Strategist) → keep Opus
- Content creation (Ember) → keep current
- Security scans (Sentinel, Keeper) → keep current

For each recommended per-task override, provide the exact YAML:
```yaml
# Example: Strategist standup uses Sonnet instead of Opus
- type: cron
  schedule: 30 13 * * *
  task: standup_synthesis
  model:
    provider: anthropic
    model: claude-sonnet-4-6
    temperature: 0.5
    maxTokens: 4096
```

### 5. Produce Report

Format as:

**Executive Summary** (3-5 bullets)
- Total estimated monthly cost (current)
- Total estimated monthly cost (recommended)
- Savings percentage
- Key model switches

**Agent-Level Changes**
| Agent | Current Model | Recommended | Reason | Monthly Impact |
|---|---|---|---|---|

**Per-Task Override Recommendations**
| Agent | Task | Current | Recommended | Frequency | Monthly Savings |
|---|---|---|---|---|---|

**Ready-to-Apply YAML**
Provide the exact trigger YAML blocks for all recommended per-task overrides so they can be committed directly.

**Models to Watch**
- Any upcoming models that could change recommendations
- Price drops or capability improvements expected

**Risk Assessment**
- Which switches are safe (low risk of quality degradation)
- Which need testing first (try one month, compare output quality)

### 6. Delivery

Post the completed report to **[your-executive-channel]** Slack channel.
Tag any changes that need [Executive]/[AI Chief of Staff] approval vs. auto-approvable.
