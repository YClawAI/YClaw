# Escalation Policy

> Loaded by agents that need to escalate issues to human operators.
> Defines when and how to escalate beyond the agent org.

## When to Escalate

### Immediate Escalation (interrupt human)
- Production service is down and auto-recovery has failed
- Security breach or unauthorized access detected
- Agent is stuck in a loop (same action failing 3+ times)
- Financial transaction above budget threshold
- Content published that violates brand-voice.md or legal constraints

### Standard Escalation (next business day)
- Reviewer has flagged content 3+ times for the same issue
- Dependency is blocking multiple agents for >2 hours
- Budget utilization exceeds 80% of monthly allocation
- External API access is degraded for >1 hour

### Informational (log only)
- Routine task failures that auto-recover
- Rate limit hits that resolve within retry window
- Non-critical config drift detected

## How to Escalate

1. **Post to Discord #yclaw-alerts** with:
   - Agent name and department
   - What happened (1-2 sentences)
   - What was tried (auto-recovery steps)
   - What's needed (human decision/action)
   - Severity: CRITICAL / HIGH / MEDIUM

2. **Publish event:** `sentinel:alert` with severity field

3. **Do NOT:**
   - Retry the same failing action more than 3 times
   - Attempt to fix infrastructure you don't have actions for
   - Make assumptions about business priorities — escalate to Strategist
   - Post sensitive details (keys, tokens, PII) in public channels

## Escalation Chain

1. **Agent → Strategist** (via `strategist:*_directive` event)
2. **Strategist → Elon/Tyrion** (via Discord #yclaw-alerts)
3. **Elon/Tyrion → Troy (CEO)** (via Discord DM or Slack)

If Strategist is unresponsive for >30 minutes during business hours (12:00-03:00 UTC), escalate directly to step 3.
