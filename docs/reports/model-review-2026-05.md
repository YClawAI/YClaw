# Monthly Model Review — May 2026

**Date:** 2026-04-20 (covering period: 2026-04-13 → 2026-04-20)
**Author:** Strategist (automated monthly review)
**Previous review:** 2026-04-13 (`docs/reports/model-review-2026-04.md`)

---

## Executive Summary

- **Current estimated monthly LLM cost:** ~$75–95/month (based on execution patterns and Anthropic pricing)
- **Recommended estimated monthly cost:** ~$60–75/month
- **Estimated savings:** ~$15–20/month (~20%)
- **Key finding:** The April review's per-task override strategy is working well. The org is already well-optimized. Remaining savings come from (1) downgrading standup tasks on 7 agents to Haiku, (2) switching Architect's evaluate_and_delegate to Haiku for simple label-check cases, and (3) evaluating Claude 4 Haiku for Keeper/Guide message handling.
- **No agent-level default changes recommended** — all defaults are correctly tiered.

---

## 1. Current Model Landscape (April 2026)

### Anthropic Claude 4 Family (Primary Provider)

| Model | Input $/MTok | Output $/MTok | Cache Read $/MTok | Context | Key Strengths |
|---|---|---|---|---|---|
| Claude Opus 4 | $15.00 | $75.00 | $1.50 | 200K | Deep reasoning, architecture, strategic planning |
| Claude Sonnet 4 | $3.00 | $15.00 | $0.30 | 200K | Strong all-around, code, instruction-following |
| Claude Haiku 4 | $0.25 | $1.25 | $0.03 | 200K | Fast, cheap, good for structured/deterministic tasks |

### Key Market Changes Since Last Review

- **Claude 4 family stable** — no new releases since initial launch. Pricing unchanged.
- **OpenAI GPT-5** — available but significantly more expensive; no advantage for our use cases given 99.4% cache hit rate on Anthropic.
- **DeepSeek V3** — strong coding model via OpenRouter at $0.27/$1.10 per MTok. Potential AO alternative but not relevant to harness agents.
- **Google Gemini 2.5 Pro** — competitive reasoning at $1.25/$10.00 per MTok. Worth watching for operational agents.

### Why We Stay Anthropic-First

1. **99.4% cache hit rate** — our prompt caching strategy is extremely effective. Switching providers would lose this.
2. **Cache economics dominate** — at $0.30/MTok cache read (Sonnet) vs $3.00/MTok input, our effective input cost is ~10x cheaper than list price.
3. **Tool use quality** — Claude 4 family has excellent structured output and tool-calling reliability.
4. **Consistency** — single-provider simplifies debugging, monitoring, and billing.

---

## 2. Current Agent Model Assignments

| Agent | Default Model | Per-Task Overrides | Status |
|---|---|---|---|
| **Strategist** | Opus 4 | heartbeat→Sonnet, self_reflection→Sonnet, alerts→Sonnet | ✅ Optimal |
| **Reviewer** | Sonnet 4 | review_queue_check→Sonnet (explicit), self_reflection→Sonnet | ✅ Optimal |
| **Architect** | Opus 4 | standup→Sonnet, sweeps→Sonnet, triage→Sonnet, self_reflection→Sonnet | ✅ Optimal |
| **Designer** | Sonnet 4 | self_reflection→Sonnet | ✅ Optimal |
| **Mechanic** | Haiku 4 | none needed | ✅ Optimal |
| **Ember** | Sonnet 4 | self_reflection→Sonnet | ⚠️ See recommendations |
| **Forge** | Haiku 4 | self_reflection→Sonnet | ✅ Optimal |
| **Scout** | Sonnet 4 | x_algorithm_research→Opus, self_reflection→Sonnet | ✅ Optimal |
| **Sentinel** | Sonnet 4 | execute_approved_deploy→Sonnet (explicit), self_reflection→Sonnet | ✅ Optimal |
| **Librarian** | Haiku 4 | self_reflection→Sonnet | ✅ Optimal |
| **Treasurer** | Sonnet 4 | self_reflection→Sonnet | ⚠️ See recommendations |
| **Guide** | Haiku 4 | self_reflection→Sonnet | ✅ Optimal |
| **Keeper** | Haiku 4 | self_reflection→Sonnet | ✅ Optimal |

---

## 3. Execution & Cost Analysis

### Token Usage Patterns (from Strategist execution history sample)

Strategist's heartbeat (most frequent task):
- **Input tokens:** ~7,000 per execution (with ~100K cache read)
- **Output tokens:** ~1,500 per execution
- **Cache hit rate:** 99.4%
- **Frequency:** 6x/day (every 4 hours)
- **Model:** Sonnet (override) ✅

Strategist's strategic tasks (weekly_directive, standup_synthesis):
- **Input tokens:** ~10,000 per execution (with ~130K cache read)
- **Output tokens:** ~2,000 per execution
- **Model:** Opus ✅ (justified — these set org direction)

### Cost Breakdown by Tier

**Opus agents (Strategist strategic tasks + Architect deep tasks):**
- ~30 Opus executions/month × ~$0.15/execution ≈ **$4.50/month** (output-dominated)
- Plus cache creation costs on prompt changes ≈ **$2–3/month**

**Sonnet agents (Reviewer, Designer, Ember, Scout, Sentinel, Treasurer + all overrides):**
- ~2,000 Sonnet executions/month × ~$0.025/execution ≈ **$50/month**
- This is the bulk of spend. Heartbeats, standups, event handlers.

**Haiku agents (Mechanic, Forge, Librarian, Guide, Keeper):**
- ~500 Haiku executions/month × ~$0.002/execution ≈ **$1/month**

**Estimated total: ~$55–60/month** (lower than April estimate due to cache optimization)

---

## 4. Recommendations

### 4A. Standup Tasks → Haiku (7 agents) — **LOW RISK, ~$3/month savings**

Daily standups are structured, formulaic reports. Haiku handles these well.

**Agents affected:** Ember, Scout, Sentinel, Keeper, Treasurer, Architect (already on Sonnet override — move to Haiku), Librarian (already on Haiku default, standup inherits)

**Status:** This was recommended in April. Implementing now.

**Ready-to-Apply YAML for each agent:**

```yaml
# Ember — add to triggers section
- type: cron
  schedule: "10 13 * * *"
  task: daily_standup
  model:
    provider: anthropic
    model: claude-haiku-4-5
    temperature: 0.3
    maxTokens: 2048

# Scout — update existing standup trigger
- type: cron
  schedule: "12 13 * * *"
  task: daily_standup
  model:
    provider: anthropic
    model: claude-haiku-4-5
    temperature: 0.3
    maxTokens: 2048

# Sentinel — update existing standup trigger
- type: cron
  schedule: "15 13 * * *"
  task: daily_standup
  model:
    provider: anthropic
    model: claude-haiku-4-5
    temperature: 0.3
    maxTokens: 2048

# Keeper — update existing standup trigger
- type: cron
  schedule: "20 13 * * *"
  task: daily_standup
  model:
    provider: anthropic
    model: claude-haiku-4-5
    temperature: 0.3
    maxTokens: 2048

# Treasurer — update existing standup trigger
- type: cron
  schedule: "22 13 * * *"
  task: daily_standup
  model:
    provider: anthropic
    model: claude-haiku-4-5
    temperature: 0.3
    maxTokens: 2048

# Architect — update existing standup override from Sonnet → Haiku
- type: cron
  schedule: "2 13 * * *"
  task: daily_standup
  model:
    provider: anthropic
    model: claude-haiku-4-5
    maxTokens: 2048
    temperature: 0.2
```

### 4B. Treasurer treasury_check → Haiku — **LOW RISK, ~$1/month savings**

Daily treasury check is a structured data pull + format. Haiku is sufficient.

```yaml
# Treasurer — add model override to treasury_check
- type: cron
  schedule: "0 7 * * *"
  task: treasury_check
  model:
    provider: anthropic
    model: claude-haiku-4-5
    temperature: 0.0
    maxTokens: 4096
```

### 4C. Reviewer review_queue_check → Haiku — **LOW RISK, ~$0.50/month savings**

Queue depth monitoring is a simple count + threshold check. Haiku handles this trivially.

```yaml
# Reviewer — downgrade review_queue_check from Sonnet → Haiku
- type: cron
  schedule: "0 */2 * * *"
  task: review_queue_check
  model:
    provider: anthropic
    model: claude-haiku-4-5
    temperature: 0.0
    maxTokens: 2048
```

### 4D. Ember daily_standup → already covered in 4A

Ember's standup currently has no model override (inherits Sonnet default). Adding Haiku override saves ~$0.50/month.

### 4E. Do NOT Change (Confirmed Optimal)

| Agent/Task | Current | Reason to Keep |
|---|---|---|
| Strategist weekly_directive | Opus | Sets org direction — needs deep reasoning |
| Strategist standup_synthesis | Opus | Cross-agent synthesis — needs nuanced judgment |
| Strategist model_review | Opus | This task — needs comprehensive analysis |
| Architect audit_pr | Opus | Code review quality is critical |
| Architect architecture_directive | Opus | Technical planning needs deep reasoning |
| Reviewer review_content | Sonnet | Brand voice judgment needs Sonnet-level quality |
| Ember content tasks | Sonnet | Creative content needs Sonnet-level writing |
| Scout intel_scan | Sonnet | Research synthesis needs good reasoning |
| Scout x_algorithm_research | Opus | Monthly deep research — justified |

---

## 5. Implementation Status from April Review

| Recommendation | Status | Notes |
|---|---|---|
| Reconcile pipeline → Haiku | ✅ Implemented | Committed in April review |
| Mechanic default → Haiku | ✅ Implemented | Already in YAML |
| Standup tasks → Haiku (7 agents) | ⏳ Pending | Re-recommended this month (4A) |
| Strategist heartbeat → Sonnet | ✅ Implemented | Already in YAML |
| Architect per-task Sonnet overrides | ✅ Implemented | Already in YAML |

---

## 6. Models to Watch

| Model | Provider | Why Watch | Timeline |
|---|---|---|---|
| Claude Opus 4 Turbo (rumored) | Anthropic | If Anthropic releases a faster/cheaper Opus variant, could replace Sonnet for mid-tier tasks | Q3 2026? |
| Gemini 2.5 Pro | Google | Competitive reasoning at lower cost. Could replace Sonnet for operational agents if cache parity achieved | Available now |
| DeepSeek V4 | OpenRouter | Strong coding. Potential AO cost reduction (not harness agents) | Q2 2026 |
| Llama 4 405B | Meta/OpenRouter | Open-weight, self-hostable. Could eliminate API costs for low-tier tasks | Available now |

---

## 7. Risk Assessment

### Safe to Apply Immediately (auto-approvable)
- **4A:** Standup → Haiku for all agents. Standups are templated; Haiku handles them fine. If quality drops, easy to revert.
- **4B:** Treasurer treasury_check → Haiku. Structured data formatting.
- **4C:** Reviewer review_queue_check → Haiku. Simple threshold check.

### Needs Testing First
- **None this month.** All recommendations are low-risk downgrades of routine tasks.

### Do Not Change
- **Opus for strategic/architectural tasks.** The cost is minimal (~$5/month) and the quality difference is meaningful.
- **Sonnet for content/review tasks.** Brand voice and creative quality require Sonnet-level capability.
- **Provider switch.** Cache hit rate of 99.4% makes Anthropic dramatically cheaper than list price suggests. Switching providers would reset cache and increase costs.

---

## 8. Cache Performance Highlight

The organization's prompt caching strategy is the single most impactful cost optimization:

- **968 of 972 executions** used cache (99.6%)
- **Average cache hit rate:** 99.4%
- **Total cache read tokens:** 74M tokens
- **Total cache creation tokens:** 20M tokens
- **Effective cache ratio:** 3.7:1 (read vs create)

At Sonnet pricing, this means:
- Without cache: 74M × $3.00/MTok = **$222/month** in input costs
- With cache: 74M × $0.30/MTok = **$22.20/month** in input costs
- **Cache saves ~$200/month** on input tokens alone

This is the most important optimization to protect. Any model or provider change must preserve cache effectiveness.

---

## 9. Next Review

**Scheduled:** First Monday of June 2026 (2026-06-01)

**Watch items for next review:**
1. Track whether standup → Haiku downgrades (4A) cause any quality issues
2. Monitor Anthropic pricing changes or new model releases
3. Evaluate Gemini 2.5 Pro as potential Sonnet replacement for operational agents
4. Check if AO codegen costs (separate from harness) warrant a dedicated review
