# CLI Reference

The `yclaw` CLI handles setup, validation, deployment, and monitoring.

```bash
npm install -g yclaw    # Global install
# or
npx yclaw <command>     # Run without installing
```

---

## Commands

### `yclaw init`

Guided setup wizard that generates configuration files.

```bash
yclaw init                                    # Interactive wizard
yclaw init --preset local-demo                # Use preset (still interactive for review)
yclaw init --preset small-team --non-interactive  # Fully automated
yclaw init --output-dir ./my-project --force  # Custom output, overwrite existing
```

**Flags:**

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--preset <name>` | string | — | Use preset: `local-demo`, `small-team`, `aws-production` |
| `--non-interactive` | boolean | false | Skip interactive prompts (requires `--preset`) |
| `--output-dir <path>` | string | `.` | Output directory for generated files |
| `--force` | boolean | false | Overwrite existing files without prompting |

**Output files:**

| File | Purpose |
|------|---------|
| `yclaw.config.yaml` | Infrastructure, channels, deployment config |
| `.env` | Credentials and secrets (mode 0600) |
| `.yclaw-cli.json` | CLI metadata sidecar (deployment target, LLM, networking) |

**Interactive wizard steps** (custom mode):

1. Purpose — evaluate / small team / production
2. Infrastructure — Docker Compose / manual
3. Channels — Discord, Slack, Telegram, Twitter (multi-select)
4. LLM provider — Anthropic / OpenAI / OpenRouter
5. Networking — local / Tailscale / public
6. Review — confirm or loop back

**Non-interactive mode:** Reads credentials from environment variables: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `SLACK_BOT_TOKEN`, `DISCORD_BOT_TOKEN`, `TELEGRAM_BOT_TOKEN`, `TWITTER_*`, `GITHUB_TOKEN`.

**TTY detection:** If stdin is not a TTY and `--non-interactive` is not set, the command fails with a message suggesting `--non-interactive --preset`.

---

### `yclaw doctor`

Preflight validation — checks prerequisites for deployment.

```bash
yclaw doctor            # Human-readable output
yclaw doctor --json     # Machine-readable JSON
```

**Flags:**

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--json` | boolean | false | Output results as JSON |

**Checks performed:**

| Check | Critical | Condition |
|-------|----------|-----------|
| Node.js >= 20 | Yes | Always |
| Docker available | Yes | Docker Compose target |
| Docker Compose v2+ | Yes | Docker Compose target |
| Disk space >= 5 GB | Yes | Always |
| Required ports available | Yes | Docker Compose target |
| `yclaw.config.yaml` valid | Yes | Always |
| `.env` exists | Yes | Always |
| Anthropic API key format | Warn | Anthropic provider |
| OpenAI API key format | Warn | OpenAI provider |
| AWS credentials | Warn | Terraform target |
| MongoDB connectivity | Warn | External database |

**Exit codes:** 0 = all checks pass, 1 = any critical check fails.

---

### `yclaw deploy`

Deploy YCLAW using the generated configuration.

```bash
yclaw deploy                    # Interactive deploy
yclaw deploy --dry-run          # Show plan without executing
yclaw deploy --detach           # Run containers in background
yclaw deploy --dev              # Build from source instead of images
yclaw deploy --skip-verification  # Skip post-deploy health checks
```

**Flags:**

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--dry-run` | boolean | false | Show deployment plan without executing |
| `--detach` | boolean | false | Run containers in background |
| `--dev` | boolean | false | Build from source (local development) |
| `--skip-verification` | boolean | false | Skip post-deploy health checks |
| `--skip-bootstrap` | boolean | false | Skip root operator creation |
| `--bootstrap-output-file <path>` | string | — | Write bootstrap credentials to file (mode 0600) |

**Deployment flow:**

1. Runs `doctor` preflight checks
2. Selects executor: Docker Compose, Terraform, or Manual
3. Shows deployment plan and asks for confirmation
4. Executes deployment
5. Waits for health check (unless `--skip-verification`)
6. Optionally bootstraps root operator (if `YCLAW_SETUP_TOKEN` is set, >= 32 chars)

**Exit codes:** 0 = success, 1 = failure.

---

### `yclaw destroy`

Tear down YCLAW infrastructure.

```bash
yclaw destroy              # Stop containers (keep data)
yclaw destroy --volumes    # Stop containers AND remove data
yclaw destroy --force      # Skip confirmation prompt
```

**Flags:**

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--volumes` | boolean | false | Remove persistent data volumes (MongoDB, Redis, PostgreSQL) |
| `--force` | boolean | false | Skip confirmation prompt |

**Exit codes:** 0 = success, 1 = failure.

---

### `yclaw status`

Show system health from a running YCLAW instance.

```bash
yclaw status                          # Human-readable output
yclaw status --json                   # Machine-readable JSON
yclaw status --verbose                # Show all components including disabled
yclaw status --api-url http://my-server:3000  # Custom API URL
```

**Flags:**

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--json` | boolean | false | Output as JSON |
| `--verbose` | boolean | false | Show all components including disabled |
| `--api-url <url>` | string | — | YCLAW API URL |
| `--api-key <key>` | string | — | Root operator API key |

**API URL resolution order:**
1. `--api-url` flag
2. `YCLAW_API_URL` environment variable
3. Config `networking.apiPort` → `http://localhost:<port>`
4. `http://localhost:3000`

**API key resolution order:**
1. `--api-key` flag
2. `YCLAW_ROOT_API_KEY` environment variable

**Exit codes:**
- 0 = healthy
- 1 = degraded (some components unhealthy)
- 2 = unreachable, auth error, or API error

---

### `yclaw config validate`

Validate `yclaw.config.yaml` against the schema.

```bash
yclaw config validate                    # Validate in current directory
yclaw config validate --config ./prod    # Validate in specific directory
yclaw config validate --strict           # Fail on warnings too
```

**Flags:**

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--config <path>` | string | `.` | Path to config directory |
| `--strict` | boolean | false | Fail on warnings (e.g., no channels enabled, no deployment target) |

**Exit codes:** 0 = valid, 1 = invalid (or warnings in strict mode).

---

## Presets

| Preset | Target | Services | Channels | LLM |
|--------|--------|----------|----------|-----|
| `local-demo` | Docker Compose | All local | None | Anthropic (Claude Sonnet) |
| `small-team` | Docker Compose | All local | Slack | Anthropic (Claude Sonnet) |
| `aws-production` | Terraform | Managed AWS | Slack + Discord | Anthropic (Claude Sonnet) |

---

## Environment Variables

| Variable | Used By | Description |
|----------|---------|-------------|
| `YCLAW_API_URL` | `status` | API URL for health checks |
| `YCLAW_ROOT_API_KEY` | `status` | Root operator API key |
| `YCLAW_SETUP_TOKEN` | `deploy` | Bootstrap token (>= 32 chars) |
| `ANTHROPIC_API_KEY` | runtime | Anthropic LLM key |
| `OPENAI_API_KEY` | runtime | OpenAI LLM key |
| `SLACK_BOT_TOKEN` | runtime | Slack channel adapter |
| `DISCORD_BOT_TOKEN` | runtime | Discord channel adapter |
| `TELEGRAM_BOT_TOKEN` | runtime | Telegram channel adapter |

---

## Exit Code Summary

| Code | Meaning |
|------|---------|
| 0 | Success / healthy |
| 1 | Failure / degraded / critical check failed |
| 2 | Unreachable / auth error (status only) |
| 130 | User cancelled (SIGINT) |
