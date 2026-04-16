# Post-Deploy Verification

> Load this skill when handling `architect:deploy_complete` events.
>
> **AO Migration Note (2026-03-27):** The Deployer agent has been retired. Deployments are now
> managed by the ao orchestrator. This skill is triggered by `architect:deploy_complete` events
> (published by Architect after ao successfully ships a new ECS revision), NOT the deprecated
> `deployer:deploy_complete` event.

## Trigger

This skill activates when Architect publishes an `architect:deploy_complete` event,
meaning a new version has been deployed to ECS via the ao orchestrator.

## Verification Steps

### Step 1: Wait for Stabilization (2 minutes)
ECS tasks need time to start, pass health checks, and register with the ALB.
Do not check immediately — wait at least 2 minutes after the event.

### Step 2: Health Check
```
GET https://agents.example.com/health
```
Verify:
- Response is 200 OK
- Version/build info matches the expected deployment (if available)
- Uptime counter is low (confirms fresh container)

### Step 3: Smoke Test — Trigger a Lightweight Agent
Use the trigger API to fire a simple task on a low-risk agent:
```json
{
  "agent": "strategist",
  "task": "Post-deploy health check: confirm you are operational. Reply with your model and current time."
}
```
This verifies:
- Agent execution pipeline works end-to-end
- LLM provider is reachable
- Event bus is functional
- MongoDB is connected

### Step 4: Check for Startup Errors
Use `github:get_contents` on recent CI logs or check Discord #yclaw-alerts for:
- Container crash loops (OOMKilled, exit code 1)
- Redis connection failures
- MongoDB connection failures
- Missing environment variables or secrets

## Response Protocol

### ✅ All Clear
Post to #yclaw-operations:
```
🛡️ Post-Deploy Verification: PASSED
Health: ✅ | Smoke test: ✅ | Errors: none
Deploy verified at HH:MM UTC
```

### ❌ Issues Found
1. Publish `sentinel:alert` event with details
2. Post to #yclaw-alerts:
```
🚨 Post-Deploy Verification: FAILED
Issue: <specific problem>
Action needed: <recommendation — rollback? restart? investigate?>
```
3. If health endpoint is down: recommend immediate rollback

## Rollback Guidance

If verification fails, recommend (do NOT execute) rollback:
```
Recommended action: Roll back to previous task definition revision.
Command: aws ecs update-service --cluster yclaw-cluster-production \
  --service yclaw-production \
  --task-definition yclaw-production:<previous-revision>
```

Sentinel does NOT have deploy:ecs action for safety — rollback requires
Deployer or human intervention.
