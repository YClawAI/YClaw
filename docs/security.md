# Security Reference

7 security domains implemented in `packages/core/src/security/`.

---

## 1. Dependency Supply Chain

Prevents compromised npm packages from reaching production.

| Layer | Mechanism | Source |
|-------|-----------|--------|
| 7-day soak | `.npmrc` `min-release-age=7d` + Renovate `minimumReleaseAge` | `.npmrc`, `renovate.json` |
| Install script blocking | `ignore-scripts=true` in `.npmrc` and `--ignore-scripts` in Dockerfile `npm ci` | `.npmrc`, `Dockerfile` |
| Frozen lockfile | `npm ci` fails on any lockfile mutation | CI workflows |
| Socket.dev | Scans for network access, obfuscated code, telemetry, malware, typosquatting, CVEs | `socket.yml` |
| SBOM | SPDX artifact generated on every deploy | CI deploy workflow |
| Dependency gate | Auto-approve (safe + 7d old + >50K/wk downloads + no install scripts), blocklist (event-stream, node-ipc, colors, faker), else human review | CI workflow |
| Trusted scopes | `@auth/*`, `@tanstack/*`, `@aws-sdk/*` auto-approved | CI workflow |

Security patches bypass the 7-day soak via Renovate vulnerability alert rules.

---

## 2. Docker Image Security

Source: `Dockerfile`, CI deploy workflows

| Control | Detail |
|---------|--------|
| SHA256 pinning | Base images pinned to digest, Renovate auto-updates |
| Multi-stage builds | Only production artifacts in final image |
| Non-root execution | Drops to `node` user via `gosu` |
| Trivy scan | Blocks on CRITICAL/HIGH findings, runs on every deploy |
| Weekly rebuild | Picks up OS-level patches |
| Install script blocking | `--ignore-scripts` in all `npm ci` commands |

---

## 3. CI/CD Pipeline

Source: `.github/workflows/`

| Control | Detail |
|---------|--------|
| SHA-pinned Actions | All Actions pinned to full 40-char commit SHAs (prevents tag hijack, ref: CVE-2025-30066 tj-actions) |
| Harden-runner | `step-security/harden-runner` first step in every job, monitors network egress |
| CODEOWNERS | `@yclaw-admins` approval required for `.github/workflows/**` |
| Workflow change guard | `workflow-change-guard.yml` flags PRs modifying security-sensitive files |
| Agent safety CI | `agent-safety.yml` blocks agent PRs touching protected paths without `human-approved` label |
| Minimal permissions | Workflow-level `permissions: contents: read`, per-job escalation only where needed |

---

## 4. Agent-Specific Security

### Agent Safety Guard

Source: `packages/core/src/security/agent-safety-guard.ts`

`validateAgentPR()` evaluates every agent PR against two path tiers:

**Forbidden paths** (hard block, never allowed):
- `CODEOWNERS`
- `packages/core/src/security/agent-safety-guard.ts`
- `.github/workflows/workflow-change-guard.yml`

**Protected paths** (require `human-approved` label):
- `.github/workflows/**`, `.github/actions/**`
- `Dockerfile*`, `docker-compose*.yml`
- `package.json`, `package-lock.json`, `pnpm-lock.yaml`
- `.npmrc`, `.pnpmrc`, `renovate.json`, `socket.yml`
- `SECURITY.md`, `CODEOWNERS`
- `packages/core/src/security/**`, `config/security/**`, `prompts/**`

**Self-modification detection** scans PR metadata for patterns that indicate
safety bypass attempts. Matches force `security-review-required` label.

### Circuit Breaker

Source: `packages/core/src/security/circuit-breaker.ts`

`AgentCircuitBreaker` enforces per-agent rate limits:

| Limit | Default | Description |
|-------|---------|-------------|
| `maxConsecutiveFailures` | 3 | Trips after N consecutive failures |
| `maxDailyPRs` | 10 | PRs per day |
| `maxDailyCostUSD` | $50 | LLM spend per day |
| `maxDailyDeployments` | 5 | Deploys per day |
| `cooldownMinutes` | 30 | Auto-reset after cooldown |

Methods: `recordFailure()`, `recordSuccess()`, `recordPR()`, `recordCost(usd)`,
`recordDeployment()`. Each `record*` method trips the breaker when its threshold
is exceeded. `isOpen()` checks breaker state and auto-resets after cooldown.

`resetDaily()` clears daily counters. `reset()` clears trip state.

### Memory Write Scanner

Source: `packages/core/src/security/memory-scanner.ts`

`MemoryWriteScanner` runs on every agent memory write before content reaches
persistent storage. Feature flag: `FF_MEMORY_SCANNER`.

| Category | Examples | Action |
|----------|----------|--------|
| Prompt injection | "ignore all previous instructions", `[INST]`, `<\|system\|>`, "you are now a", "pretend to be" | Block |
| Credential patterns | Anthropic/OpenAI API keys, GitHub PATs, Slack tokens, MongoDB URIs, PEM keys, JWTs, AWS access keys | Block |
| Exfiltration URLs | webhook.site, requestbin, ngrok, pipedream, beeceptor, localtunnel, serveo | Block |
| Invisible unicode | U+200B-200F, U+202A-202E (incl. RTL override), U+FEFF, variation selectors, word joiners | Block |

On detection: logs warning, emits `security:write_blocked` event on the bus,
returns `{ blocked: true, issues }`. Caller enforces the block.

### Network Egress Allowlist

Source: `packages/core/src/security/egress-allowlist.ts`

Agent containers are restricted to approved endpoints. `isEgressAllowed(endpoint)`
validates against the allowlist with wildcard support.

Allowed destinations:
- LLM APIs: `api.anthropic.com`, `api.openai.com`, `generativelanguage.googleapis.com`, `api.x.ai`
- Code hosting: `api.github.com`, `github.com`
- Package registry: `registry.npmjs.org`
- AWS: `*.amazonaws.com`
- Security: `api.socket.dev`

---

## 5. Runtime Security

All production containers enforce:

| Control | Detail |
|---------|--------|
| Read-only root filesystem | ECS Fargate `readonlyRootFilesystem: true` |
| No new privileges | `no-new-privileges:true` security option |
| Drop all capabilities | `cap_drop: ALL` |
| Non-root execution | Entrypoint drops to `node` user via `gosu` |
| Tmpfs for writable paths | Bounded size |
| No SSH | No shell access to production containers |
| Network isolation | Default deny inter-container, explicit allowlist for service-to-service |
| Credential isolation | Agents never see raw secrets; OIDC + short-lived tokens; separate credentials per agent role |

---

## 6. Monitoring

| Control | Detail |
|---------|--------|
| OpenSSF Scorecard | Weekly automated analysis via `scorecard.yml`, SARIF results in GitHub Security tab |
| New dependency alert | Slack notification on dependency additions |
| Lockfile anomaly | CRITICAL alert if lockfile changes without package.json change |
| Dockerfile/workflow change | Alert + require admin approval |
| Circuit breaker trip | Alert human operator |

### Security Audit Log

Source: `packages/core/src/security/audit-log.ts`

`createAuditEntry()` produces immutable audit records for every agent action:

```typescript
interface AuditEntry {
  timestamp: string;
  agentId: string;
  action: string;
  target: string;
  decision: 'allowed' | 'blocked' | 'escalated';
  reason?: string;
  changedFiles?: string[];
  costUSD?: number;
}
```

---

## 7. Event Bus Authentication

Source: `packages/core/src/security/eventbus/`

All inter-agent events use HMAC-SHA256 signed envelopes. Addresses unauthenticated
event forgery that could lead to prompt injection.

### Envelope Format

Defined in `envelope.ts`:

```typescript
interface EventEnvelope {
  id: string;              // UUID
  type: string;            // e.g. "reviewer:flagged"
  source: string;          // e.g. "agent:reviewer"
  subject?: string;
  timestamp: string;       // ISO 8601
  nonce: string;           // 16 random bytes, hex
  schemaVersion: string;   // "1.0"
  payload: Record<string, unknown>;
  auth: {
    alg: string;           // "hmac-sha256"
    keyId: string;         // e.g. "kid_reviewer_v1"
    sig: string;           // base64url HMAC
  };
}
```

Signature covers ALL fields except `auth` via canonical JSON serialization
(recursively sorted keys, no whitespace, `undefined` normalized to `null`).
Verification uses `timingSafeEqual` on Buffers to prevent timing attacks.

### HKDF Key Derivation

Source: `keys.ts`

Per-agent keys derived from a master secret via HKDF-SHA256. A compromised
agent key cannot forge events from other agents.

- `deriveAgentKey(masterSecret, agentId, version)` -- info string: `yclaw-eventbus-{agentId}-v{version}`
- `KeyResolver` -- maps keyId to secret, supports dual-key verification during rotation (current + previous version)

### 6-Stage Validation Pipeline

Source: `middleware.ts`

Every received event passes through all stages. Any failure rejects the event
and logs to the audit trail.

| Stage | What | Error Codes |
|-------|------|-------------|
| 1. Envelope parsing | Size check (64KB max), required fields, type validation, ISO timestamp | `EVENT_TOO_LARGE`, `MISSING_FIELD` |
| 2. Signature verification | Resolve key by keyId, verify HMAC-SHA256 | `UNKNOWN_KEY`, `INVALID_SIGNATURE` |
| 3. Freshness & replay | Timestamp within maxAgeSeconds (120s), clock skew tolerance (30s), event ID + source:nonce dedup via Redis NX | `FUTURE_EVENT`, `EXPIRED_EVENT`, `REPLAY_DETECTED`, `NONCE_REPLAY` |
| 4. Source authorization | Agent must be registered in policy, event type must be in agent's allowed list | `UNKNOWN_SOURCE`, `UNAUTHORIZED_EVENT_TYPE` |
| 5. Schema validation | Zod strict schema (no extra fields), globally denied field check | `NO_SCHEMA`, `SCHEMA_VIOLATION`, `DENIED_FIELD` |
| 6. Safe projection | Strips auth block, labels source as verified, passes only payload as "facts" to LLM context | (no errors) |

### Schema Registry

Source: `schemas.ts`

Events without a registered schema are REJECTED (fail closed). All schemas use
`.strict()` to block extra-field injection.

Registered event types: `reviewer:flagged`, `reviewer:approved`, `reviewer:rejected`,
`deploy:execute`, `deploy:status`, `deploy:assess`, `deploy:approve`,
`safety:modify`, `safety:alert`, `architect:build_directive`,
`architect:repair_directive`, `strategist:directive`, `strategist:priority`,
`content:draft`, `content:published`.

### Authorization Policy

Source: `policy.ts`

Loaded from `yclaw-event-policy.yaml`. Defines per-source allowed event types
and globally denied payload fields.

Event payloads are validated against a denylist of fields that could enable
prompt injection or safety bypasses.

Replay protection defaults: max age 120s, max clock skew 30s, cache TTL 600s.

### Secure Publisher

Source: `publisher.ts`

`SecurePublisher` is a drop-in replacement for raw Redis PUBLISH that
automatically wraps, signs, and publishes envelopes. Agents use this instead of
manually constructing envelopes, making unsigned events impossible through
normal code paths.

```typescript
const publisher = new SecurePublisher(redis, 'reviewer', masterSecret);
await publisher.publish('reviewer:flagged', { reason: '...', severity: 'high' });
```

### Safe LLM Context Projection

Source: `projection.ts`

`projectToAgentContext()` converts a verified envelope into a minimal
`SafeEventContext` for injection into agent LLM prompts. Strips the auth block,
nonce, and schema version. Labels the source as `verified: true`.

---

## Vulnerability Reporting

Report via [GitHub Private Security Advisory](https://github.com/GravitonINC/YClaw/security/advisories/new).
Do not open public issues. Response: 72-hour acknowledgment, 30-day fix target.

See `/SECURITY.md` for full disclosure policy.
