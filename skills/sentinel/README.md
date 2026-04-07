# Sentinel Skills

Sentinel is the monitoring and quality assurance agent in the **Operations** department. It monitors infrastructure health, audits code quality, and verifies deployments.

## Purpose

Sentinel watches over the YClaw Agents platform. It performs scheduled health checks, audits code in target repositories for machine-verifiable issues, and verifies that deployments succeed after Deployer completes them.

## Skill Files

| File | Description |
|------|-------------|
| `code-audit-standards.md` | Code quality audit standards for `code_quality_audit` tasks (Mon/Thu schedule). Defines three severity levels (High: hardcoded secrets, SQL injection, broken imports; Medium: dead exports, missing error handling, test gaps; Low: stale TODOs, unused deps). Includes a `codegen:execute` template for scanning repos. Sentinel reports findings only -- it never opens PRs or commits fixes. |
| `deploy-health-checklist.md` | Periodic health checklist for `deployment_health` cron tasks (every 4 hours). Checks API health (`GET /health`), recent deployment status, CI pipeline state, and event bus errors. Posts one-liner status summaries to operations channel; posts full details only when issues are found. |
| `post-deploy-verification.md` | Post-deployment verification procedure triggered by `deployer:deploy_complete` events. Waits 2 minutes for stabilization, runs health check, triggers a smoke test on a lightweight agent (strategist), and checks for startup errors. Posts results to operations channel (pass) or publishes `sentinel:alert` + posts to alerts channel (fail). Recommends rollback commands but does not execute them (safety constraint). |

## Key Behaviors

- **Health monitoring**: Every 4 hours, checks API, CI, deployments, and event bus. Posts concise status to operations channel.
- **Code audits**: Runs Mon/Thu. Scans for machine-verifiable issues only (no style opinions). High severity triggers immediate `sentinel:alert` events. Medium severity aggregated into `sentinel:quality_report`.
- **Post-deploy verification**: Activates on `deployer:deploy_complete`. Validates health, runs smoke test, checks for crash loops. Reports pass/fail. Recommends (but cannot execute) rollback.
- **Alert routing**: Critical issues go to `sentinel:alert` event + alerts channel. Warnings go to operations channel.

## Integration with Other Skills

- Subscribes to `deployer:deploy_complete` events from **Deployer**.
- Publishes `sentinel:alert` events consumed by the alerting pipeline.
- Uses `codegen:execute` to run code audits on target repositories via the codegen system.
- Absorbed some monitoring functions from the removed Signal agent (PR #312).
