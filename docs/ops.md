# Operations Runbook

## Infrastructure

| Component | Detail |
|-----------|--------|
| Cluster | `yclaw-cluster-production` (ECS Fargate, us-east-1) |
| Agents Service | `yclaw-production` (port 3000) |
| Mission Control | `yclaw-mc-production` (port 3001, Next.js dashboard) |
| Internal ALB | `yclaw-internal-production` — Tailscale-only (private IPs) |
| Public ALB | `yclaw-lb-production` — internet-facing (GitHub webhooks via API GW) |
| Database | MongoDB Atlas |
| Cache | Redis (managed) |
| CI | GitHub Actions → Docker build → ECR → ECS deploy |
| LiteLLM | Pinned to `v1.82.3-stable` (see `infra/litellm/SECURITY-HOLD.md` — supply chain compromise in 1.82.7/1.82.8) |
| ACM Cert | `*.yclaw.ai` (wildcard, used by both ALBs) |

### Network Architecture

```
Internet ──→ API Gateway ──→ Lambda ──→ yclaw-lb-production (public ALB)
                                              ↓
                                    yclaw-production (port 3000)

Tailscale ──→ Subnet Router (<INTERNAL_HOST>) ──→ yclaw-internal-production (internal ALB)
                                                       ↓
                                             yclaw-mission-control-production (port 3001)
```

- **`agents.yclaw.ai`** (default) → Mission Control (port 3001)
- **`agents.yclaw.ai/api/*`** → Agents API (port 3000)
- **`agents.yclaw.ai/health`** → Agents API
- **`agents.yclaw.ai/github/webhook`** → Agents API
- **`webhooks.yclaw.ai`** → Public ALB → Agents service (for future direct webhook use)
- GitHub webhooks use API Gateway (`<API_GATEWAY_ID>.execute-api.us-east-1.amazonaws.com`)

## Health Checks

```bash
# Mission Control (requires Tailscale)
curl https://agents.yclaw.ai/api/health

# Agents service (when running)
curl https://agents.yclaw.ai/health
```

## Logs

All logs go to CloudWatch `/ecs/yclaw`.

```bash
# Latest log stream (changes per ECS task)
aws logs describe-log-streams \
  --log-group-name /ecs/yclaw \
  --order-by LastEventTime --descending --limit 1

# Tail logs
aws logs tail /ecs/yclaw --follow
```

## Deploy

Deploys happen automatically via CI on push to `master`:
1. GitHub Actions builds Docker image
2. Pushes to ECR
3. Registers new task definition
4. Updates ECS service

### Manual Task Definition Update

```bash
# Register new task def (edit JSON first)
aws ecs register-task-definition --cli-input-json file://task-def.json

# Update service to use it
aws ecs update-service \
  --cluster yclaw-cluster-production \
  --service yclaw-production \
  --task-definition yclaw-production:<revision>
```

### Rollback

```bash
# Find previous working revision
aws ecs describe-services \
  --cluster yclaw-cluster-production \
  --services yclaw-production \
  --query 'services[0].deployments'

# Roll back to specific revision
aws ecs update-service \
  --cluster yclaw-cluster-production \
  --service yclaw-production \
  --task-definition yclaw-production:<previous-revision>
```

## ECS Service Restart

Use when agents have stale event backlogs or need a clean start:

```bash
aws ecs update-service \
  --cluster yclaw-cluster-production \
  --service yclaw-production \
  --force-new-deployment
```

## Mission Control

Mission Control is the Next.js dashboard for managing and monitoring agents.

| Component | Detail |
|-----------|--------|
| ECR Repo | `yclaw-mission-control` |
| ECS Service | `yclaw-mission-control-production` |
| Task Def | `yclaw-mission-control-production` (512 CPU, 1024 MB) |
| Port | 3001 |
| URL | `https://agents.yclaw.ai` (Tailscale-only) |
| Logs | CloudWatch `/ecs/yclaw` prefix `mission-control` |

### Access

Mission Control is behind an internal ALB (`yclaw-internal-production`). DNS resolves
to private VPC IPs (`<VPC_IP>`), only routable through the Tailscale subnet router.

**Requirements**: Tailscale connected to the YClaw tailnet.

If DNS cache is stale after changes:
```bash
sudo dscacheutil -flushcache && sudo killall -HUP mDNSResponder
```

### Deploy Mission Control

```bash
# Login to ECR
aws ecr get-login-password --region us-east-1 | docker login --username AWS \
  --password-stdin <AWS_ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com

# Build from repo root (must target linux/amd64 for Fargate)
docker build --platform linux/amd64 \
  -f packages/mission-control/Dockerfile \
  -t yclaw-mission-control .

# Tag and push
docker tag yclaw-mission-control:latest \
  <AWS_ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com/yclaw-mission-control:latest
docker push \
  <AWS_ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com/yclaw-mission-control:latest

# Force new deployment
aws ecs update-service \
  --cluster yclaw-cluster-production \
  --service yclaw-mission-control-production \
  --force-new-deployment \
  --region us-east-1
```

### Mission Control Logs

```bash
# Tail mission-control logs
aws logs tail /ecs/yclaw --follow \
  --filter-pattern '"mission-control"'
```

### Mission Control Rollback

```bash
# Find previous task definition revision
aws ecs list-task-definitions \
  --family-prefix yclaw-mission-control-production \
  --sort DESC --max-items 5 --region us-east-1

# Roll back
aws ecs update-service \
  --cluster yclaw-cluster-production \
  --service yclaw-mission-control-production \
  --task-definition yclaw-mission-control-production:<revision> \
  --region us-east-1
```

### Terraform Status

Mission Control infrastructure was deployed manually (CLI). The following resources
need to be added to `terraform/main.tf`:

- `aws_ecr_repository.mission_control`
- `aws_lb.internal` (internal ALB)
- `aws_security_group.internal_alb`
- `aws_lb_target_group.mission_control`
- `aws_lb_listener.internal_https` + `aws_lb_listener.internal_http`
- `aws_ecs_task_definition.mission_control`
- `aws_ecs_service.mission_control`
- `aws_security_group_rule` for port 3001 (ECS tasks SG, from both ALBs)
- `aws_route53_record` for `agents.yclaw.ai` (alias → internal ALB)
- `aws_route53_record` for `webhooks.yclaw.ai` (alias → public ALB)

## Trigger an Agent Manually

```bash
curl -s -X POST https://agents.yclaw.ai/api/trigger \
  -H "Content-Type: application/json" \
  -H "x-api-key: $YCLAW_API_KEY" \
  -d '{"agent":"<name>","task":"<description>"}'
```

Trigger is async — returns `executionId`. Poll via `/api/executions?id=<id>`.

## Environment Variables

Key env vars in the ECS task definition:

| Variable | Purpose | Default |
|----------|---------|---------|
| `NODE_ENV` | `production` | — |
| `MONGODB_URI` | Atlas connection string | required |
| `REDIS_URL` | Managed Redis endpoint | required |
| `REACTION_LOOP_ENABLED` | Enable/disable GitHub reaction pipeline | `false` |
| `ARCHITECT_GITHUB_LOGINS` | GitHub logins for comment-based PR approval | unset |
| `EXECUTOR_TYPE` | Executor routing: `cli` / `pi` | `cli` |
| `FF_CONTEXT_COMPRESSION` | Haiku context compression at 85% threshold | `false` |
| `FF_PROMPT_CACHING` | Frozen prompt snapshots + Anthropic cache_control | `true` |
| `FF_MEMORY_SCANNER` | MemoryWriteScanner WAF on all writes | `false` |
| `FF_SKILL_GUARD` | SkillGuard static safety scan | `false` |
| `FF_OBSIDIAN_GATEWAY` | WriteGateway vault writes + auto-commit | `false` |
| `FF_SKILLS_GOVERNANCE` | SkillLoader tier enforcement + progressive disclosure | `false` |
| `FF_AUTO_CLAUDECEPTION` | ClaudeceptionPipeline automated skill extraction | `false` |
| `PI_CODING_AGENT_ENABLED` | Enable Pi executor backend | `false` |
| `PI_CODING_AGENT_DIR` | Pi SDK config directory | `/tmp/pi-agent-config` |
| `SECRET_BACKEND` | Secret storage backend: `mongodb`, `env`, `file` | `mongodb` |

Secrets are pulled from AWS Secrets Manager at container start.

**Note:** `PI_CODING_AGENT_ENABLED` is a feature flag for the Pi executor backend. When enabled, the agent system can delegate coding tasks to the Pi coding agent instead of (or in addition to) the CLI executor.

### Enabling Subsystems in Production

All `FF_*` flags default to `false`. Enable them incrementally:

```bash
# Enable vault writes + memory scanner together (recommended first pair)
aws secretsmanager update-secret --secret-id yclaw/production/secrets \
  --secret-string '{"FF_OBSIDIAN_GATEWAY":"true","FF_MEMORY_SCANNER":"true",...}'

# Then restart the service to pick up new values
aws ecs update-service \
  --cluster yclaw-cluster-production \
  --service yclaw-production \
  --force-new-deployment
```

## OpenClaw Proxy

A socat TCP proxy on EC2 that bridges the ECS VPC to the OpenClaw VM via Tailscale.

| Component | Detail |
|-----------|--------|
| EC2 Instance | `<EC2_INSTANCE_ID>` (`<INTERNAL_HOST>`) |
| Listen | `<INTERNAL_HOST>:53847` |
| Forward To | `<OPENCLAW_GATEWAY_HOST>:53847` (OpenClaw VM Tailscale IP) |
| systemd Service | `openclaw-proxy.service` |

### Management

```bash
# SSH to the proxy host
ssh ec2-user@<INTERNAL_HOST>

# Check proxy status
systemctl status openclaw-proxy.service

# Restart proxy
sudo systemctl restart openclaw-proxy.service

# View proxy logs
journalctl -u openclaw-proxy.service -f
```

## Budget Enforcement

Per-agent spend caps controlled via Mission Control.

| Property | Detail |
|----------|--------|
| Toggle | `BUDGET_ENFORCEMENT_ENABLED` env var (`true`/`false`) |
| Default action | Alert only (posts to `#yclaw-alerts`, does not pause agents) |
| Dashboard | Mission Control → Budget panel |

### Checking Budget Status

Check the `BUDGET_ENFORCEMENT_ENABLED` env var in the ECS task definition. When enabled, per-agent daily and monthly caps are enforced. The default behavior is alert-only.

### Adjusting Budgets

Budget caps are configured in Mission Control. Changes take effect immediately (no ECS restart needed).

## Monitoring

- **Slack #yclaw-alerts** — agent escalations
- **Slack #yclaw-operations** — routine ops
- **CloudWatch** — container logs at `/ecs/yclaw`
- **GitHub Actions** — CI status

## Redis Streams Monitoring (Coordination Events)

Coordination events use Redis Streams (key pattern: `yclaw:stream:{prefix}`).
All `coord.*` events flow through `yclaw:stream:coord`. Streams are capped at
~10,000 entries via MAXLEN.

```bash
# List all coordination streams
redis-cli KEYS 'yclaw:stream:*'

# Stream length (should stay under ~10,000)
redis-cli XLEN yclaw:stream:coord

# Consumer group summary — check for lag
redis-cli XINFO GROUPS yclaw:stream:coord

# Per-consumer details (pending count, idle time)
redis-cli XINFO CONSUMERS yclaw:stream:coord <group-name>

# Full stream metadata
redis-cli XINFO STREAM yclaw:stream:coord FULL

# Read last 5 entries (most recent first)
redis-cli XREVRANGE yclaw:stream:coord + - COUNT 5

# Read entries in a time range (Unix ms timestamps)
redis-cli XRANGE yclaw:stream:coord <start-ms>-0 <end-ms>-0

# Pending entries (PEL) — entries claimed but not ACK'd
redis-cli XPENDING yclaw:stream:coord <group-name>

# Pending entries with details (first 10)
redis-cli XPENDING yclaw:stream:coord <group-name> - + 10

# Reclaim a stuck entry (idle > 5 minutes = 300000ms)
redis-cli XCLAIM yclaw:stream:coord <group> <new-consumer> 300000 <entry-id>

# Manual acknowledgment (removes from PEL)
redis-cli XACK yclaw:stream:coord <group-name> <entry-id>
```

### Journaler Health

The Journaler consumes `coord.*` events via consumer group `journaler` and posts
milestone comments on GitHub issues.

**Indicators:**
- CloudWatch logs: search for `journaler` logger entries
- GitHub issues labeled `coordination` should have recent comments
- `"Journaler started"` at container startup
- `"Failed to post comment"` indicates GitHub API issues (non-fatal)

**Checking pending events:**
```bash
# Journaler-specific pending count
redis-cli XPENDING yclaw:stream:coord journaler

# If pending count is growing, Journaler may be stuck
redis-cli XPENDING yclaw:stream:coord journaler - + 10
```

### SlackNotifier Health

The SlackNotifier consumes `coord.*` events via consumer group `slack-notifier` and
posts Block Kit messages to department Slack channels.

**Indicators:**
- CloudWatch logs: search for `slack-notifier` logger entries
- Slack channels (`#yclaw-development`, `#yclaw-alerts`, etc.) should have recent posts
- `"SlackNotifier started"` at container startup
- `"Failed to post Slack message"` or `"Slack post exception"` indicates API issues (non-fatal)

**Checking pending events:**
```bash
# SlackNotifier-specific pending count
redis-cli XPENDING yclaw:stream:coord slack-notifier

# If pending count is growing, SlackNotifier may be stuck
redis-cli XPENDING yclaw:stream:coord slack-notifier - + 10

# Check thread grouping keys
redis-cli KEYS 'slack:thread:*'
```

**Common issues:**

| Symptom | Cause | Fix |
|---------|-------|-----|
| No Slack posts | `SLACK_BOT_TOKEN` missing or expired | Check AWS Secrets Manager; restart ECS |
| SlackNotifier disabled at startup | EventStream not available | Check Redis Streams connectivity |
| Posts not threading | Redis `slack:thread:*` keys expired or missing | Expected after 7 days; new thread starts |
| Rate limit errors from Slack | Burst exceeds Slack Tier 2 limits | Internal queue handles this; check for excessive event volume |

See [`docs/COORDINATION.md`](COORDINATION.md) for the full coordination system reference.

### Slack Alert Dedup

The `SlackExecutor` deduplicates agent direct posting (`slack:message`/`slack:alert`)
via Redis fingerprinting. Identical messages to the same channel are suppressed within
a configurable window (30min–2hr depending on channel).

```bash
# List all active dedup fingerprints
redis-cli KEYS 'slack:dedup:*'

# Count active fingerprints
redis-cli KEYS 'slack:dedup:*' | wc -l

# Check a specific fingerprint's TTL
redis-cli TTL 'slack:dedup:<fingerprint>'

# Clear all dedup keys (allow all messages through)
redis-cli KEYS 'slack:dedup:*' | xargs redis-cli DEL
```

**Common issues:**

| Symptom | Cause | Fix |
|---------|-------|-----|
| Legitimate re-alerts suppressed | TTL too long for the channel | Adjust `CHANNEL_DEDUP_TTL` in `slack.ts` |
| Dedup not working | `slackDedupRedis` not connected | Check `"Slack dedup Redis connected"` in startup logs |
| Duplicate alerts despite dedup | Messages differ in volatile fields not covered by normalization | Add new normalization regex in `fingerprint()` |

## Department Settings (MongoDB org_settings)

Department settings are stored in MongoDB `org_settings` collection with documents keyed `dept_{name}` (e.g., `dept_executive`, `dept_development`).

### Verify settings are saved

```bash
# Connect to MongoDB and check a department's settings
mongosh "$MONGODB_URI" --eval 'db.org_settings.findOne({ _id: "dept_executive" })'
```

### Verify settings are read by agents (SettingsOverlay)

The `SettingsOverlay` class reads these documents with a 5-minute cache. Look for these log entries in CloudWatch:

```bash
# Check if cron was skipped due to MC toggle
aws logs tail /ecs/yclaw --follow --filter-pattern '"Cron skipped (disabled via MC)"'

# Check for settings load failures (graceful — falls back to YAML)
aws logs tail /ecs/yclaw --follow --filter-pattern '"Failed to load overrides"'
```

### Cache behavior

- **TTL**: 5 minutes (matches BudgetEnforcer)
- **Graceful degradation**: If MongoDB is unreachable, SettingsOverlay returns null and YAML defaults are used
- **No manual cache clear**: Cache clears on the next TTL expiry. Restarting the ECS service forces a fresh read.

### What's wired vs what's not

| Setting | Saves to MongoDB | Read by Core Runtime |
|---------|:---:|:---:|
| Department directive | Yes | Yes (SettingsOverlay → system prompt) |
| Model override | Yes | Yes (SettingsOverlay → agent config) |
| Temperature override | Yes | Yes (SettingsOverlay → agent config) |
| Cron toggles | Yes | Yes (checked in cron handler) |
| Event toggles | Yes | Schema present, not yet enforced |
| Brand assets | Yes | No |
| Engagement limits | Yes | No |
| SLA targets | Yes | No |
| Notification prefs | Yes | No |

## General Troubleshooting

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| Agents stopped producing output | Budget enforcement paused them | Check `BUDGET_ENFORCEMENT_ENABLED`; review budget caps in Mission Control |
| Mission Control unreachable | Tailscale disconnected or socat proxy down | Check Tailscale status; SSH to `<INTERNAL_HOST>` and check `systemctl status openclaw-proxy.service` |
| SSE streaming broken in chat | socat proxy not forwarding correctly | Restart `openclaw-proxy.service` on proxy host |
| New env vars not in container | CI bypasses Terraform (describe→swap→register) | Run `terraform apply` then force new ECS deployment |
| Agent memory writes blocked | MemoryWriteScanner false positive | Check CloudWatch for `security:write_blocked` events; review scanner patterns |
