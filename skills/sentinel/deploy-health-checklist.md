# Deploy Health Checklist

> Load this skill during `deployment_health` cron tasks.
>
> **AO Migration Note (2026-03-27):** The Deployer agent and its assessment system have been
> retired. Deployments are now managed by the ao orchestrator via CI. Do NOT use `deploy:assess`
> — it no longer exists. Use `deploy:status` for ECS service health checks instead.

## What to Check (every 4 hours)

### 1. API Health
Call the YClaw Agents API health endpoint:
```
GET https://agents.example.com/health
```
Expected: 200 OK with uptime and version info.
If unhealthy: publish `sentinel:alert` and post to #yclaw-alerts.

### 2. ECS Service Health (yclaw only)

`yclaw` deploys to ECS Fargate. Use `deploy:status` to check current ECS service state.
Look for:
- `running_count` matches `desired_count` (all tasks healthy)
- `task_definition` revision is recent (compare to last known good)
- `last_deployment_at` timestamp — if older than 7 days with recent CI pushes, investigate
- `deployment_status` is `PRIMARY` (not stuck in `ACTIVE` with a failed replacement)

**Do NOT use `deploy:assess`** — the Deployer assessment system was deleted on 2026-03-27.

If `deploy:status` returns degraded state (running < desired, rollback in progress, etc.):
- Publish `sentinel:alert`
- Post details to #yclaw-alerts

### 3. your-landing-repo (Vercel — exclude from ECS checks)

`your-landing-repo` is deployed via **Vercel auto-deploy** (triggered on push to `main`). It does NOT
have an ECS service. Do NOT check ECS or `deploy:status` for this repo.

To verify your-landing-repo health, use `github:get_contents` to check recent GitHub Actions workflow
runs on the `your-org/your-landing-repo` repo:
- Is the latest `deploy` workflow green?
- Any failing builds on `main` in the last 24 hours?

If your-landing-repo CI is failing, post a warning to #yclaw-operations. Do NOT classify it as
"DORMANT" — Vercel auto-deploys mean the absence of a recent ECS deploy is expected and healthy.

### 4. CI Pipeline
Use `github:get_contents` to check recent workflow runs on `yclaw`:
- Is the latest CI run green?
- Are there failing checks on master?
- Any workflows stuck/queued for >30 minutes?

### 5. SHA Drift Baselines

SHA drift checks flag when deployed artifacts diverge from expected source commits. After the
AO migration, many workflow files were legitimately changed — do NOT flag these as drift.

**Auto-update rule:** If the Architect has published an `architect:audit_approved` event since
the last SHA baseline snapshot, treat the current HEAD of `master` as the new baseline. Do not
raise drift alerts against commits that postdate the last approved audit.

**Stale baseline detection:** If the stored SHA baseline is older than 14 days AND there have
been successful CI deploys since then, the baseline is stale. Log a low-severity note and
auto-advance the baseline to the last successfully deployed commit. Do NOT raise a drift alert
for this condition.

### 6. Event Bus
Check Discord #yclaw-operations and #yclaw-alerts for:
- Agent error patterns (same agent failing repeatedly)
- Event delivery failures
- Redis connection issues

## Alert Thresholds

| Condition | Severity | Action |
|-----------|----------|--------|
| Health endpoint down | 🔴 Critical | `sentinel:alert` + #yclaw-alerts immediately |
| ECS running < desired | 🔴 Critical | `sentinel:alert` + #yclaw-alerts |
| CI failing on master | 🟡 Warning | Post to #yclaw-operations |
| Deployment stuck >1h | 🟡 Warning | Post to #yclaw-operations |
| 3+ failed deploys in 24h | 🔴 Critical | `sentinel:alert` + #yclaw-alerts |
| Agent error loop detected | 🟡 Warning | Post to #yclaw-operations |
| SHA baseline stale >14d | 🟢 Low | Auto-advance baseline, log only |
| your-landing-repo CI failing | 🟡 Warning | Post to #yclaw-operations |

## Reporting
Post a brief status summary to #yclaw-operations after each check:
```
🛡️ Health Check [HH:MM UTC]
API: ✅/❌ | ECS: ✅/❌ | CI: ✅/❌ | Landing: ✅/❌ | Alerts: N
```
Only post full details if something is wrong. Healthy = one-liner.
