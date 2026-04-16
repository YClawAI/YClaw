# Sentinel Skill: Alerting Noise Control

> Deduplication, batching, and suppression rules. Load this skill before publishing
> any `sentinel:alert` event. Noisy alerting is worse than no alerting — humans
> train themselves to ignore it.

## Deduplication

**Rule:** Same `alert_type` + same `resource` within a 30-minute window → suppress the duplicate, increment a counter on the original alert.

Store the original alert in agent memory under key `alert:{alert_type}:{resource}` with timestamp. On a subsequent same-key alert:

- If `now - original_timestamp < 30 min` → do NOT publish. Update memory with `suppressed_count = suppressed_count + 1` and `last_suppressed_at = now`.
- If `now - original_timestamp >= 30 min` → publish a new alert that includes `suppressed_count` since the previous burst, then reset.

## Batching

**Rule:** Multiple LOW-severity alerts within a 15-minute window → batch into a single summary alert instead of firing each individually.

Buffer LOW-severity alerts in memory key `alert_batch:low`. Flush every 15 min:

- If 0 items in buffer → do nothing.
- If 1 item → publish as a normal LOW alert.
- If 2+ items → publish a single `sentinel:alert` with `alert_type: batched_low` and a `findings` array containing all buffered items.

Do NOT batch MEDIUM/HIGH/CRITICAL alerts — those get published individually, always.

## Escalation Ladder

**Rule:** An alert fires → wait 30 min → if unresolved, escalate its severity by one level.

- MEDIUM unresolved 30 min → re-publish as HIGH with `escalated_from: medium` and the original alert's `id`.
- HIGH unresolved 30 min → re-publish as CRITICAL.
- CRITICAL unresolved → do NOT auto-escalate further. CRITICAL means a human should already be paged.

An alert is "resolved" when a `sentinel:alert` with `alertType: *_recovered` fires for the same resource, OR when it's explicitly acknowledged via `strategist:sentinel_directive` with `acknowledged: true`.

## Suppression Windows

**Rule:** During known deploys, suppress transient health-check failures.

Subscribe to `architect:deploy_started` and `architect:deploy_complete` (add to `event_subscriptions` in `sentinel.yaml` if missing — this is the enabling prerequisite).

- On `architect:deploy_started` for `{repo, environment}` → enter suppression mode. Store `suppression:{repo}:{environment}` in memory with TTL of 10 minutes or until `architect:deploy_complete`.
- While suppression is active for a resource: swallow `health_check_fail` alerts for that resource ONLY. All other alert types fire normally.
- On `architect:deploy_complete` or TTL expiry → exit suppression. Publish a summary of suppressed alerts with `suppressed_during_deploy: true`.

## Cool-Down After Recovery

**Rule:** After an incident resolves, suppress related alerts for 1 hour to avoid alert storms from recovery oscillation.

When a `*_recovered` alert fires:

- Store `cooldown:{alert_type}:{resource}` with TTL 60 min.
- Re-firing the same alert during cool-down → suppress unless severity is CRITICAL.
- After cool-down expires, clear the key. Next failure fires normally.

## NEVER Suppress

These classes bypass ALL dedup, batching, cool-down, and suppression rules:

- **Security incidents** (any severity) — unauthorized access, credential exposure, policy violations.
- **Data loss** — missing records, corrupted state, partial-write signatures.
- **Complete outages** — health endpoint returning non-2xx for >5 min, ECS running count == 0, Redis/Mongo unreachable.

If in doubt whether an alert is "never suppress", fire it. Over-alerting CRITICAL is preferable to missing one.

## Counter Discipline

Every suppressed or batched alert must be:

1. Counted in agent memory.
2. Surfaced in the next `standup:report` (even if you did not publish it at the time).
3. Included in the weekly `sentinel:quality_report` so trends are visible.

Silent suppression is worse than noise. Always leave a trail.
