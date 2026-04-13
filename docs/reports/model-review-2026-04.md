# Monthly Model Review — April 2026

**Date:** 2026-04-13  
**Author:** Strategist  
**Review Period:** 2026-04-07 to 2026-04-13 (first operational week)  

---

## Executive Summary

- **Current config is well-optimized** — most high-frequency tasks already have per-task Sonnet/Haiku overrides
- **2 agents on Opus** (Strategist, Architect) — justified for strategic planning and architectural decisions
- **1 agent on Haiku** (Forge) — correct for asset dispatch/coordination work
- **10 agents on Sonnet 4** — good default tier for most operational workloads
- **Prompt cache hit rate: 99.2% average** — excellent, dramatically reducing effective input token costs
- **Key savings opportunity:** Strategist's `reconcile_pipeline` (runs every 10 min) should use Haiku instead of Sonnet
- **Estimated monthly savings from recommended changes: ~15-20%** on Strategist token spend

---

## Current Model Landscape (April 2026)

### Anthropic Claude Family

| Model | Input $/1M | Output $/1M | Cache Read $/1M | Cache Write $/1M | Context | Best For |
|-------|-----------|------------|-----------------|------------------|---------|----------|
| claude-opus-4-6 | $15.00 | $75.00 | $1.50 | $18.75 | 200K | Deep reasoning, architecture, strategy |
| claude-sonnet-4-6 | $3.00 | $15.00 | $0.30 | $3.75 | 200K | General purpose, content, reviews |
| claude-sonnet-4-20250514 | $3.00 | $15.00 | $0.30 | $3.75 | 200K | Same tier as Sonnet 4, older version |
| claude-haiku-4-5 | $0.80 | $4.00 | $0.08 | $1.00 | 200K | Fast, cheap, structured tasks |

### Key Insight: Cache Hit Rate Dominance

With 99.2% cache hit rates across executions, the effective input cost is:
- **Opus effective input:** ~$1.50/1M (vs $15 list) — **90% savings**
- **Sonnet effective input:** ~$0.30/1M (vs $3 list) — **90% savings**
- **Haiku effective input:** ~$0.08/1M (vs $0.80 list) — **90% savings**

This means **output tokens dominate costs**, making the output price differential the primary optimization lever:
- Opus output: $75/1M
- Sonnet output: $15/1M (5x cheaper)
- Haiku output: $4/1M (18.75x cheaper)

---

## Agent-Level Model Assignments

### Current State

| Agent | Default Model | Per-Task Overrides | Assessment |
|-------|--------------|-------------------|------------|
| **Strategist** | Opus | heartbeat→Sonnet, standup→Sonnet, alerts→Sonnet, deploys→Sonnet | ✅ Well-configured |
| **Architect** | Opus | standup→Sonnet, triage→Sonnet, evaluate→Sonnet, reflect→Sonnet | ✅ Well-configured |
| **Reviewer** | Sonnet 4 | reflect→Sonnet | ✅ Correct tier |
| **Designer** | Sonnet 4 | reflect→Sonnet | ✅ Correct tier |
| **Mechanic** | Sonnet (old) | none | ⚠️ Consider Haiku |
| **Ember** | Sonnet 4 | reflect→Sonnet | ✅ Correct tier |
| **Forge** | Haiku 4.5 | reflect→Sonnet | ✅ Correct tier |
| **Scout** | Sonnet 4 | reflect→Sonnet | ✅ Correct tier |
| **Sentinel** | Sonnet 4 | reflect→Sonnet | ✅ Correct tier |
| **Librarian** | Sonnet 4 | reflect→Sonnet | ✅ Correct tier |
| **Treasurer** | Sonnet 4 | reflect→Sonnet | ✅ Correct tier |
| **Guide** | Sonnet 4 | reflect→Sonnet | ✅ Correct tier |
| **Keeper** | Sonnet 4 | reflect→Sonnet | ✅ Correct tier |

### Recommendations

| Agent | Current | Recommended | Reason | Risk |
|-------|---------|-------------|--------|------|
| **Strategist** | Opus (default) | Keep Opus | Weekly directives, monthly strategy need deep reasoning | — |
| **Architect** | Opus (default) | Keep Opus | Architecture decisions, PR audits, cross-repo planning need Opus-level reasoning | — |
| **Mechanic** | Sonnet (old) | **claude-haiku-4-5** | Mechanical tasks (lockfile sync, formatting, rebasing) are deterministic — Haiku is sufficient | Low |
| **Forge** | Haiku 4.5 | Keep Haiku | Asset coordination is structured/templated work | — |

---

## Per-Task Override Recommendations

### Priority 1: Strategist `reconcile_pipeline` → Haiku

**Current:** Uses Sonnet (no override, falls to default Opus minus the existing Sonnet cron override)  
**Issue:** Runs every 10 minutes (144x/day). Does 2-3 tool calls (task:summary, list_issues, get_issue) and produces ~500 tokens of output. This is mechanical triage work.  
**Recommendation:** Override to Haiku

```yaml
# strategist.yaml — reconcile_pipeline override
- type: cron
  schedule: "*/10 * * * *"
  task: reconcile_pipeline
  model:
    provider: anthropic
    model: claude-haiku-4-5
    temperature: 0.2
    maxTokens: 4096
```

**Estimated savings:** ~500 output tokens × 144 runs/day × 30 days = 2.16M output tokens/month  
At Sonnet ($15/1M) vs Haiku ($4/1M): saves ~$23.76/month on this task alone.

### Priority 2: Mechanic default → Haiku

**Current:** claude-sonnet-4-20250514  
**Issue:** Mechanic only runs whitelisted commands (lockfile sync, formatting, rebasing). No creative reasoning needed.  
**Recommendation:** Switch default model

```yaml
# mechanic.yaml — change default
model:
  provider: anthropic
  model: claude-haiku-4-5
  temperature: 0.1
  maxTokens: 4096
```

**Risk:** Low — tasks are deterministic. Monitor first month for any failures.

### Priority 3: Standup tasks across all agents → Haiku

Most agents have daily standup tasks that produce ~200-400 tokens of structured output. These are formulaic.

**Agents to add standup override for:**
- Ember, Scout, Forge, Sentinel, Treasurer, Guide (all currently use their default Sonnet for standups)

```yaml
# Example: ember.yaml standup override
- type: cron
  schedule: "10 13 * * *"
  task: daily_standup
  model:
    provider: anthropic
    model: claude-haiku-4-5
    temperature: 0.3
    maxTokens: 4096
```

**Estimated savings:** 7 agents × ~300 output tokens × 30 days = 63K output tokens/month  
Marginal savings (~$0.69/month) but establishes good hygiene.

### Priority 4: Sentinel `deployment_health` → Haiku

**Current:** Runs every 4 hours on Sonnet  
**Issue:** Health checks are structured verification — check endpoints, compare expected vs actual  
**Recommendation:**

```yaml
# sentinel.yaml — deployment_health override
- type: cron
  schedule: "0 */4 * * *"
  task: deployment_health
  model:
    provider: anthropic
    model: claude-haiku-4-5
    temperature: 0.0
    maxTokens: 4096
```

### Priority 5: Librarian `daily_curation` → Haiku

**Current:** Runs daily on Sonnet  
**Issue:** Vault triage is structured (check inbox, file notes, deduplicate). Pattern matching, not reasoning.

```yaml
# librarian.yaml — daily_curation override
- type: cron
  schedule: "0 14 * * *"
  task: daily_curation
  model:
    provider: anthropic
    model: claude-haiku-4-5
    temperature: 0.0
    maxTokens: 4096
```

---

## Sonnet Version Consolidation

**Issue:** Two Sonnet versions in use:
- `claude-sonnet-4-6` (newer, used as agent defaults)
- `claude-sonnet-4-20250514` (older, used in per-task overrides)

**Recommendation:** Standardize all Sonnet references to `claude-sonnet-4-6` for consistency. The newer version has equivalent or better capabilities.

**Affected configs (per-task overrides using old Sonnet):**
- strategist.yaml: 6 trigger overrides
- architect.yaml: 4 trigger overrides  
- All agents: self_reflection trigger overrides

This is a cosmetic/consistency change with no cost impact (same pricing tier).

---

## Usage Data Analysis

### Strategist (most active agent)

| Metric | Value |
|--------|-------|
| Total executions | 687 |
| Success rate | 99.85% |
| Average cache hit rate | 99.2% |
| Total cache read tokens | 49.5M |
| Total cache creation tokens | 13.6M |
| Self-modifications | 123 |

**Task frequency breakdown (from execution history):**
- `reconcile_pipeline`: ~144/day (every 10 min) — **highest volume, lowest complexity**
- `heartbeat`: ~48/day (every 30 min) — already on Sonnet ✅
- `standup_synthesis`: 1/day — already on Sonnet ✅
- `handle_system_alert`: event-driven, ~2-5/day — already on Sonnet ✅
- `handle_blocked_task`: event-driven, ~1-3/day — already on Sonnet ✅
- `weekly_directive`: 1/week — uses Opus (correct) ✅
- `model_review`: 1/month — uses Opus (correct) ✅

### Other Agents

Execution volume across non-strategist agents is currently low (org launched 2026-04-07). Most agents are event-driven and activate only when triggered. Cost optimization for these agents is less impactful until volume increases.

---

## Cost Estimates

### Current Monthly Estimate (based on observed patterns)

| Component | Tokens/Month (est.) | Model | Cost/Month |
|-----------|---------------------|-------|------------|
| Strategist output (Opus tasks) | ~200K | Opus | ~$15.00 |
| Strategist output (Sonnet tasks) | ~3M | Sonnet | ~$45.00 |
| Strategist input (cached) | ~50M | Mixed | ~$15.00 |
| Architect output | ~500K | Mixed | ~$12.00 |
| All other agents | ~1M | Sonnet | ~$15.00 |
| **Total estimated** | | | **~$102/month** |

### After Recommended Changes

| Component | Change | Savings |
|-----------|--------|---------|
| Strategist reconcile → Haiku | 2.16M tokens at $4 vs $15 | ~$24/month |
| Mechanic → Haiku | Minor volume | ~$2/month |
| Standup overrides → Haiku | 63K tokens | ~$1/month |
| Sentinel health → Haiku | 180 runs × ~300 tokens | ~$0.50/month |
| **Total savings** | | **~$27.50/month (~27%)** |

---

## Models to Watch

1. **Claude Opus 4 successor** — If Anthropic releases a next-gen Opus, evaluate for Strategist/Architect. Current Opus is excellent for our needs.
2. **Haiku 4.5 successor** — Any Haiku improvements directly benefit Forge and our proposed Haiku overrides.
3. **DeepSeek R1 / Qwen 3** (via OpenRouter) — For future cost optimization on operational agents, open-source models could reduce costs further. Not recommended yet — Anthropic's prompt caching gives us 90% input savings that open-source models can't match.
4. **xAI Grok** — Monitor for competitive pricing. Currently not cost-competitive with Anthropic's cached pricing.

---

## Risk Assessment

| Change | Risk Level | Notes |
|--------|-----------|-------|
| reconcile_pipeline → Haiku | **Low** | Mechanical triage, 2-3 tool calls, structured output |
| Mechanic → Haiku | **Low** | Deterministic tasks, whitelisted commands only |
| Standup overrides → Haiku | **Low** | Templated output, minimal reasoning needed |
| Sentinel health → Haiku | **Low** | Structured health checks |
| Sonnet version consolidation | **None** | Same pricing, equivalent capabilities |

**No high-risk changes recommended this month.** The current architecture is sound — the main optimization is pushing mechanical/repetitive tasks down to Haiku.

---

## Action Items

### Auto-approvable (Strategist can apply)
1. ✅ Apply `reconcile_pipeline` → Haiku override to strategist.yaml
2. ✅ Apply Sonnet version consolidation across trigger overrides

### Needs Leadership Approval
3. ⚠️ Switch Mechanic default model from Sonnet to Haiku (agent-level model change)
4. ⚠️ Apply standup → Haiku overrides across 7 agent configs (batch change)
5. ⚠️ Apply Sentinel deployment_health → Haiku override
6. ⚠️ Apply Librarian daily_curation → Haiku override

---

*Next review: First Monday of May 2026*
