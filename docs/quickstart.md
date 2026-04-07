# Quickstart — Zero to Running in 15 Minutes

This guide gets you from nothing to a running YCLAW instance with Mission Control dashboard using Docker Compose.

> **Cost warning:** Running agents with frontier models (Claude Opus) costs $50-100+/day in LLM API calls. The `local-demo` preset starts with no active channels and minimal configuration. You control when agents start consuming LLM tokens.

---

## Prerequisites

| Requirement | Minimum | Check |
|-------------|---------|-------|
| Node.js | 20+ | `node --version` |
| Docker | 20+ with Compose v2 | `docker compose version` |
| Disk space | 5 GB free | `df -h .` |
| LLM API key | Anthropic recommended | [console.anthropic.com](https://console.anthropic.com) |

---

## Step 1: Initialize

```bash
npx yclaw init --preset local-demo
```

This generates three files:

| File | Purpose |
|------|---------|
| `yclaw.config.yaml` | Infrastructure and channel configuration |
| `.env` | Credentials and secrets (mode 0600) |
| `.yclaw-cli.json` | CLI metadata sidecar |

Edit `.env` and set your `ANTHROPIC_API_KEY` (or whichever LLM provider you chose).

---

## Step 2: Validate

```bash
npx yclaw doctor
```

The doctor runs 10+ checks: Node version, Docker availability, port availability, config schema validation, credential format. Fix anything marked FAIL before proceeding.

---

## Step 3: Deploy

```bash
npx yclaw deploy --detach
```

This starts Docker Compose with MongoDB, Redis, PostgreSQL, the Core runtime, and Mission Control. The `--detach` flag runs containers in the background.

Wait for the health check to pass (usually 15-30 seconds).

---

## Step 4: Open Mission Control

Visit [http://localhost:3001](http://localhost:3001).

You'll see the dashboard with system health, agent status, and the onboarding prompt.

---

## Step 5: Check Status

```bash
npx yclaw status
```

Shows infrastructure health, channel status, agent counts, and recent errors. Exit code 0 means healthy.

---

## Step 6: Complete Onboarding

In Mission Control, walk through the onboarding flow. Answer questions about your organization across 6 stages:

1. **Org Framing** — Answer questions about your organization's mission, priorities, voice, departments, and tools
2. **Context Ingestion** — Upload documents, paste GitHub repo URLs, or add text notes
3. **Department Review** — Review and customize generated department configurations
4. **Operator Invitations** — Invite additional operators with appropriate tier and department access
5. **Validation** — Run health checks against each department
6. **Complete** — Finalize onboarding and start operating

---

## Step 7: Tear Down (when done)

```bash
npx yclaw destroy              # Stop containers
npx yclaw destroy --volumes    # Stop containers AND delete data
```

---

## What's Next

- **Add channels:** Re-run `yclaw init` (custom mode) to enable Slack, Discord, Telegram, or Twitter
- **Invite operators:** Use Mission Control or the `/v1/operators/invite` API
- **Customize agents:** Edit YAML configs in your `departments/` directory
- **Go to production:** Use `--preset aws-production` for managed AWS services

See [CLI Reference](cli.md) for the full CLI reference and [Configuration](configuration.md) for all config options.

---

## Common Pitfalls

### Docker not running

```
Error: Docker daemon is not running
Fix: Start Docker Desktop or run `sudo systemctl start docker`
```

### Port already in use

```
Error: Port 3000 is already in use
Fix: Stop the process using the port, or set API_PORT=3100 in .env
```

Common ports: 3000 (Core API), 3001 (Mission Control), 27017 (MongoDB), 6379 (Redis), 5432 (PostgreSQL).

### Missing ANTHROPIC_API_KEY

```
Error: ANTHROPIC_API_KEY not set
Fix: Edit .env and add your key from console.anthropic.com
```

The `.env` file is created with placeholder values. You must set real credentials before deploying.

### Wrong Node.js version

```
Error: Node.js version 18.x detected, 20+ required
Fix: Install Node.js 20+ via nvm, fnm, or nodejs.org
```

YCLAW uses ES2022 features and ESM modules that require Node 20+.

### Config validation fails

```
Error: Invalid yclaw.config.yaml — storage.state.type must be "mongodb"
Fix: Run `npx yclaw config validate` to see all errors, then edit yclaw.config.yaml
```

Config files must pass the Zod schema. The `config validate` command shows exactly what's wrong.

### Docker Compose v1 (not v2)

```
Error: Docker Compose v2 required
Fix: Upgrade Docker Desktop (includes Compose v2) or install docker-compose-plugin
```

YCLAW uses `docker compose` (v2 syntax), not `docker-compose` (v1).

### Health check fails after deploy

```
Error: Health check failed — API unreachable at http://localhost:3000
Fix: Wait 30 seconds for services to start, then run `npx yclaw status`
```

MongoDB and Redis need time to initialize. If it persists, check `docker compose logs` for errors.

### Permission denied on .env

```
Error: EACCES: permission denied, open '.env'
Fix: Check file permissions — .env should be mode 0600 (owner read/write only)
```

The CLI creates `.env` with restrictive permissions. If you created it manually, run `chmod 600 .env`.
