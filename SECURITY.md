# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in this project, please report it
responsibly via [GitHub Private Security Advisory](https://github.com/GravitonINC/YClaw/security/advisories/new).

**Do not open public GitHub issues for security vulnerabilities.** Public
disclosure before a fix is available puts all users at risk. We ask that you
give us the opportunity to investigate and remediate before any public disclosure.

Please include:
- A description of the vulnerability and its potential impact
- Steps to reproduce the issue or a proof-of-concept
- Any relevant logs, screenshots, or supporting material
- The version(s) of the software affected

## Response Timeline

- **72 hours** — acknowledgment of your report
- **30 days** — target timeframe for a fix or mitigation

## Dependency Security Policy

### 7-Day Soaking Period

All new package versions must be published for at least **7 days** before they
can be installed. This is enforced at multiple layers:

| Layer | Mechanism |
|-------|-----------|
| `.npmrc` | `min-release-age=7d` (npm v10.9+) |
| Renovate | `minimumReleaseAge: "7 days"` |
| Dependency Gate CI | Evaluates age, popularity, install scripts, scope |

Security patches bypass the cooldown via Renovate's vulnerability alert rules.

### Install Script Blocking

`ignore-scripts=true` in `.npmrc` and `--ignore-scripts` in all Dockerfile
`npm ci` commands. This prevents malicious `postinstall` execution — the
primary attack vector in npm supply chain compromises (DPRK/Lazarus Group).

### Frozen Lockfile Enforcement

CI uses `npm ci` (frozen lockfile). Any lockfile mutation during install
fails the build. This prevents lockfile manipulation attacks.

### Package Behavior Analysis

Socket.dev integration (`socket.yml`) scans all dependency changes for:
- Network access, shell access, filesystem access
- Obfuscated code, telemetry, malware
- Typosquatting, install scripts
- Critical CVEs

### SBOM Generation

Every deploy generates an SPDX SBOM artifact for rapid triage when
dependencies are compromised.

## CI/CD Pipeline Security

### Action Pinning

**All GitHub Actions are pinned to full 40-character commit SHAs.** Version tags
are mutable — the [tj-actions attack](https://github.com/tj-actions/changed-files/security/advisories/GHSA-vgwj-r36g-hjq5)
(March 2025, CVE-2025-30066) hijacked tags to exfiltrate secrets from 23,000+ repos.

### Harden-Runner

`step-security/harden-runner` is the first step in every CI job. It monitors
network egress to detect compromised dependencies exfiltrating secrets during builds.

### Workflow Change Protection

- `CODEOWNERS` requires `@yclaw-admins` approval for all `.github/workflows/**` changes
- `workflow-change-guard.yml` flags PRs modifying security-sensitive files
- `agent-safety.yml` blocks agent PRs touching protected paths without `human-approved` label

### Minimal Permissions

Workflow-level `permissions: contents: read`. Per-job escalation only where needed
(e.g., `id-token: write` for OIDC in deploy jobs).

## Agent Security Model

### Protected Paths

AI agents cannot self-approve changes to security-critical files. Two tiers:

**Forbidden** (hard block — even with human approval):
- `CODEOWNERS`
- `packages/core/src/security/agent-safety-guard.ts`
- `.github/workflows/workflow-change-guard.yml`

**Protected** (requires `human-approved` label):
- `.github/workflows/**`, `.github/actions/**`
- `Dockerfile*`, `docker-compose*.yml`
- `.npmrc`, `.pnpmrc`, `renovate.json`, `socket.yml`
- `SECURITY.md`, `packages/core/src/security/**`
- `prompts/**`, `config/security/**`

### Dependency Security Gate

A smart gate CI check auto-approves safe dependencies and blocks sketchy ones:
- Socket.dev clean + age >= 7 days + downloads > 50K/wk + no install scripts = auto-approve
- Trusted scopes (`@auth/*`, `@tanstack/*`, `@aws-sdk/*`, etc.) = auto-approve
- Permanent blocklist (event-stream, node-ipc, colors, faker, etc.) = always block
- Everything else = requires human review

### Circuit Breakers

Per-agent rate limits prevent runaway behavior:
- Max 3 consecutive failures before cooldown
- Max 10 PRs per day
- Max $50 LLM spend per day
- Max 5 deployments per day
- 30-minute cooldown after circuit trip

### Self-Modification Detection

PR titles and bodies are scanned for patterns like "remove safety", "disable
security", "bypass guard", "skip review" — these trigger mandatory human review.

### Network Egress Allowlist

Agent containers are restricted to approved endpoints:
- LLM APIs (Anthropic, OpenAI, Google, xAI)
- GitHub API
- npm registry
- AWS services

## Runtime Security

### Container Hardening

All production containers enforce:
- **Read-only root filesystem** (ECS Fargate `readonlyRootFilesystem: true`)
- **No new privileges** (`no-new-privileges:true` security option)
- **Drop all capabilities** (`cap_drop: ALL`)
- **Non-root execution** (entrypoint drops to `node` user via `gosu`)
- **Tmpfs for writable paths** (bounded size)

### Network Policies

- Default deny all inter-container communication
- Explicit allowlist for service-to-service connections
- Agent containers cannot reach other agent containers directly
- All external egress through monitored proxy

### Immutable Infrastructure

- No SSH access to production containers
- All changes flow through CI/CD pipeline
- Container images are the deployment artifact
- Read-only root filesystem enforced at orchestrator level

### Credential Isolation

- Agents never see raw API keys or secrets
- OIDC federation + short-lived tokens where possible
- AWS Secrets Manager for runtime injection
- Separate credentials per agent role (principle of least privilege)

## Docker Image Security

- Base images pinned to SHA256 digests (Renovate auto-updates)
- Trivy vulnerability scan on every deploy (blocks on CRITICAL/HIGH)
- Weekly base image rebuild to pick up OS-level patches
- Multi-stage builds — only production artifacts in final image
- `--ignore-scripts` in all `npm ci` commands

## Monitoring

### OpenSSF Scorecard

Weekly automated scorecard analysis (`scorecard.yml`). Results published to
GitHub Security tab as SARIF.

### Automated Alerts

- New dependency additions → Slack notification
- Lockfile changes without package.json change → CRITICAL alert
- Dockerfile/workflow changes → alert + require admin approval
- Circuit breaker triggered → alert human operator

## Incident Response

See [`docs/security/incident-response.md`](docs/security/incident-response.md)
for the full playbook covering:
1. Detection
2. Triage (< 15 minutes)
3. Containment (< 1 hour for CRITICAL/HIGH)
4. Eradication
5. Recovery
6. Post-incident review

## Scope

In scope: authentication/authorization bypass, data exposure, injection
vulnerabilities (including prompt injection), privilege escalation,
cryptographic weaknesses, SSRF, insecure deserialization, agent self-modification.

Out of scope: social engineering, DoS, previously reported issues, theoretical
vulnerabilities without PoC, third-party dependency issues (report upstream).

## Credit

Reporters who follow responsible disclosure will be credited in release notes
unless they prefer anonymity.
