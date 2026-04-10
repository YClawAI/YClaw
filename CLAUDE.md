# CLAUDE.md — YCLAW

> Project-level instructions for AI coding tools (Claude Code, Codex, OpenCode, Cursor, Windsurf).
> This file is loaded automatically when working in this repository.
>
> 📖 **For comprehensive system documentation, see [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)** — canonical reference for all 12 agents, actions, triggers, events, safety, costs, deploy governance, memory, and infrastructure.

---

## OSS Workflow Rules (Mandatory)

These rules apply to ALL contributors — human and AI.

### Branching & Merging
- **Trunk-based development.** All PRs target `main`.
- **Squash merges only.** One commit per PR in main's history.
- **No direct pushes to `main`.** Everything goes through a PR. No exceptions.
- **Branch naming:** `feat/description`, `fix/description`, `docs/description`, `chore/description`.

### Versioning
- **CalVer** — `YYYY.M.D` format (e.g., `2026.4.7`). Not SemVer.
- No Changesets, no semantic-release, no release-please.
- Releases are **manual** — a maintainer triggers the npm/Docker release workflow with a version tag.

### PR Requirements
- One logical change per PR. Don't bundle unrelated work.
- PR title follows conventional format: `feat:`, `fix:`, `docs:`, `chore:`, `test:`, `refactor:`.
- All CI checks must pass before merge.
- Minimum 1 review required (human or AI reviewer).
- AI-authored PRs must be marked with `ai-authored` label.
- No refactor-only PRs unless they unblock a concrete feature.

### Before You Code
1. **Read this file first.** Understand the architecture before making changes.
2. **Check existing systems.** Search the codebase before proposing new code. The CLI, onboarding service, validation runner, and deploy executors are already built.
3. **Run the test suite** before opening a PR: `npm test`
4. **Run typecheck**: `npx tsc -p packages/core/tsconfig.json --noEmit`

### What Exists (DO NOT REINVENT)
- **CLI:** `packages/cli/` — init, doctor, deploy, destroy, status, config validate
- **Onboarding:** `packages/core/src/onboarding/` — 6-stage flow, artifact generation, ingestion
- **Mission Control UI:** `packages/mission-control/src/app/onboarding/` — full onboarding UI
- **Validation:** `packages/core/src/onboarding/validation.ts` — department config health
- **Context Cache:** `packages/core/src/agent/context-cache.ts` — 4-layer prompt hierarchy
- **Deploy Executors:** Docker Compose, Terraform, Manual in `packages/cli/src/deploy/`

### Commit Messages
```
feat: add webhook retry logic
fix: resolve race condition in event dispatcher  
docs: update onboarding API reference
chore: upgrade vitest to 3.x
test: add integration tests for operator bootstrap
refactor: extract HMAC signing to shared util
```

### Protected Paths (require admin approval)
- `.github/workflows/**`
- `packages/core/src/security/**`
- `Dockerfile*`
- `CLAUDE.md`
- `SECURITY.md`
- `LICENSE`

---

## Project Overview

**yclaw** is the autonomous AI agent system that operates the YClaw.
It is a TypeScript monorepo (turborepo + npm) running on Node 20 LTS with ESM modules.

The system consists of 12 agents organized into 6 departments:
- **Executive**: strategist, reviewer
- **Development**: architect, designer
- **Marketing**: ember, forge, scout
- **Operations**: sentinel, librarian
- **Finance**: treasurer
- **Support**: guide, keeper

Each agent has a YAML config (`departments/<dept>/<agent>.yaml`), system prompts
(`prompts/*.md`), and is executed by the shared runtime in `packages/core/`.

## Repository Structure

```
yclaw/
├── departments/           # Agent YAML configs (IMMUTABLE)
│   ├── development/       # architect, builder, deployer, designer
│   ├── executive/         # strategist, reviewer
│   ├── finance/           # treasurer
│   ├── marketing/         # ember, forge, scout
│   ├── operations/        # sentinel
│   └── support/           # guide, keeper
├── prompts/               # System prompt markdown files (IMMUTABLE)
├── packages/
│   ├── core/              # Runtime engine
│   │   ├── src/
│   │   │   ├── actions/       # Tool executors (github, slack, event)
│   │   │   ├── agent/         # Agent executor
│   │   │   ├── builder/       # Dispatcher, Worker, TaskQueue, Types
│   │   │   ├── codegen/       # Code generation orchestrator + CLI/Pi executors
│   │   │   │   └── backends/  # spawn-cli-executor, pi-executor, executors (router), types
│   │   │   ├── config/        # Config loader, repo registry, schemas
│   │   │   ├── data/          # Data resolvers
│   │   │   ├── llm/           # LLM provider abstraction
│   │   │   ├── logging/       # Structured logging
│   │   │   ├── review/        # Review gate, outbound safety
│   │   │   ├── self/          # Self-modification tools
│   │   │   ├── services/      # Task registry, task store
│   │   │   ├── triggers/      # Cron, event bus, webhooks
│   │   │   ├── index.ts       # Public API exports
│   │   │   └── main.ts        # Application entry point
│   │   └── tests/             # Test files (vitest)
│   ├── memory/            # Shared memory/knowledge store package
│   └── mission-control/   # Next.js 14 dashboard UI (port 3001, separate ECR repo)
│                          #   See docs/MISSION-CONTROL.md for full architecture
├── Dockerfile             # yclaw ECS image (core runtime)
├── docs/                  # Architecture and design references
│   ├── DISPATCHER.md      # Builder Dispatcher-Worker architecture
├── repos/                 # Target repo YAML configs
├── skills/                # Per-agent learned skills (Claudeception)
└── .github/workflows/     # CI/CD (IMMUTABLE)
```

## Development Commands

```bash
# Install dependencies
npm install

# Build all packages
npm run build

# Run tests
npm test                                    # All tests
npm run test --workspace=packages/core      # Core package only

# Type check
npx tsc -p packages/core/tsconfig.json --noEmit

# Lint
npm run lint

# Start the agent runtime
npm start

```

## TypeScript Configuration

Strict mode is mandatory:

```jsonc
"strict": true,
"noUncheckedIndexedAccess": true,
"exactOptionalPropertyTypes": true,
"noImplicitOverride": true,
"verbatimModuleSyntax": true,
"isolatedModules": true
```

ESM only — use `.js` extensions in imports. Use `import type` for type-only imports.

## Testing Conventions

- **Test location**: `packages/core/tests/*.test.ts` (NOT colocated with source)
- **Framework**: vitest
- **Config**: `packages/core/vitest.config.ts`
- **Pattern**: Test behavior, not implementation. Mock boundaries, not logic.
- **Naming**: `{module-name}.test.ts` matching the source file basename

Do NOT place test files next to source files in `src/`. The vitest config only
includes `tests/**/*.test.ts`.

## Protected Paths

### Constitutional (CI-enforced, requires `human-approved` label)

These 3 paths are protected by the Agent Safety Guard CI check (`.github/workflows/agent-safety.yml`).
PRs modifying them require a `human-approved` label to pass CI:

```
.github/workflows/**        # CI/CD configuration
packages/core/src/safety/** # Safety infrastructure
packages/core/src/review/** # Review gate and outbound safety
```

### Convention-enforced (Architect review + CI)

These paths are protected by convention and repository review practices at merge time:

```
departments/**              # Agent YAML configs
prompts/*.md                # System prompts
tsconfig.json               # Compiler settings
.eslintrc*, .prettierrc*    # Linting config
CLAUDE.md                   # This file
```

---

## Architecture

### Agent Execution Flow

```
Trigger (cron/event/webhook)
    → Config Loader (YAML + prompts + memory)
    → LLM Call (with tools)
    → Action Executors (github, slack, event, codegen)
    → Review Gate (for external content)
    → Audit Log
```

### Event Bus

Agents communicate via an internal event bus (`packages/core/src/triggers/event.ts`).
Events follow the pattern `source:type` (e.g., `builder:pr_ready`, `architect:pr_review`).

### Key Subsystems

| Subsystem | Location | Purpose |
|---|---|---|
| Agent Executor | `src/agent/executor.ts` | Runs agent tasks with LLM + tools |
| Config Loader | `src/config/loader.ts` | Loads agent YAML, prompts, memory |
| Repo Registry | `src/config/repo-registry.ts` | Multi-repo config management |
| Event Bus | `src/triggers/event.ts` | Inter-agent pub/sub |
| GitHub Webhooks | `src/triggers/github-webhook.ts` | Webhook → normalized events |
| Task Registry | `src/services/task-registry.ts` | Task state machine |
| Review Gate | `src/review/reviewer.ts` | Brand review for external content |
| Outbound Safety | `src/review/outbound-safety.ts` | Content safety filtering |
| Codegen | `src/codegen/` | CLI tool orchestration |
| Builder Dispatcher | `src/builder/dispatcher.ts` | Priority queue, threadKey generation, worker pool |
| Builder Worker | `src/builder/worker.ts` | Task execution via CLI (`AgentExecutor`) or Pi (`PiCodingExecutor`), graceful shutdown |
| CLI Executor | `src/codegen/backends/spawn-cli-executor.ts` | `AgentExecutor` wrapped as `CodingExecutor` |
| Pi Executor | `src/codegen/backends/pi-executor.ts` | In-process Pi SDK executor with YClaw-safe custom tools |
| Executor Router | `src/codegen/backends/executors.ts` | Selects Pi vs CLI per-task based on config + task hints |
| Dispatcher Architecture | `docs/DISPATCHER.md` | Full architecture reference |

#### Dispatcher Phases Summary

| Phase | Feature | Key Mechanism |
|-------|---------|---------------|
| 1-4 | Core dispatch | Priority queue, worker pool, task routing |
| 5 | Graceful shutdown | SIGTERM re-queue, drain timeout |
| 6 | Queue reliability | Startup recovery, DLQ auto-retry, event dedup (NX key per `{taskName}:{repo}:{id}`), backpressure |
| 7 | Zombie prevention | Correlation staleness gate (`BUILDER_CORRELATION_MAX_AGE_MS`, default 2h), correlation-level dedup (NX key per correlationId), stale-aware retry, DLQ staleness expiry, startup stale flush, `POST /api/builder/queue/flush` |

Correlation IDs follow `owner/repo:context:epoch_ms`. IDs without a valid trailing epoch bypass the timestamp-based staleness check, but the `failedAt`-based expiry (Phase 8) catches them by marking DLQ entries permanent when the failure itself is >2h old. See `docs/DISPATCHER.md` for full Phase 7 details.

| 8 | Project circuit breaker | In-memory project-level failure tracking. After 3 failures for the same project/issue within 2h, new tasks for that project are auto-rejected. Prevents Strategist from generating infinite failing tasks for broken projects. |

### Phase 8: Project Circuit Breaker & DLQ Expiry Hardening

**Problem solved:** UUID-style correlation IDs (e.g., `1636fd81`) returned `null` from `correlationAgeMs()`, bypassing ALL staleness checks. Combined with Strategist re-dispatching fresh tasks (new correlationIds, `dlqRetryCount: 0`), this created infinite DLQ cycling.

**Circuit breaker** (`dispatcher.ts`):
- Tracks failures per project key (derived from `triggerPayload`: `project_id`, `repo+issue_number`, or `repo+pr_number`)
- Threshold: 3 failures in 2h window → circuit OPEN → new tasks rejected
- In-memory Map with periodic sweep (every 10min) and LRU eviction (max 100 projects)
- Single-threaded assumption: Map access is safe in Node.js event loop but needs synchronization if dispatcher moves to worker threads
- Reset: `dispatcher.resetProjectCircuit(key)` — for manual override after fixing the root cause
- Inspect: `dispatcher.getOpenCircuits()` — returns all currently tripped circuits

**DLQ `failedAt` expiry** (`task-queue.ts`):
- New staleness check in `retryEligibleDlqEntries()`: marks entries permanent when `failedAt` is older than `BUILDER_CORRELATION_MAX_AGE_MS` (default 2h)
- Runs AFTER the existing timestamp-encoded correlation check (additive, not replacing)
- Catches all correlation formats including UUIDs, random strings, missing timestamps

---

## GitHub Webhook Event Pipeline

The GitHub webhook pipeline normalizes inbound events and publishes them onto
the internal event bus for downstream consumers.

### Flow

```
GitHub Webhook (POST /github/webhook)
    → GitHubWebhookHandler (src/triggers/github-webhook.ts)
        → Signature verification (HMAC-SHA256)
        → Event normalization (webhook payload → internal event)
        → Event Bus publish
```

### Webhook Event Normalization

The `GitHubWebhookHandler` normalizes raw GitHub webhook payloads into internal
event types:

| GitHub Event | Internal Event | When |
|---|---|---|
| `workflow_run` (completed, failure) | `github:ci_fail` | CI fails on any branch |
| `workflow_run` (completed, success) | `github:ci_pass` | CI passes on any branch |
| `pull_request` (opened) | `github:pr_opened` | New PR created |
| `pull_request_review` (submitted) | `github:pr_review_submitted` | Review submitted |
| `pull_request` (closed, merged) | `github:pr_merged` | PR merged |
| `issues` (opened) | `github:issue_opened` | New issue created |
| `issues` (assigned) | `github:issue_assigned` | Issue assigned |

Each normalized event includes: `owner`, `repo`, `repo_full`, `branch`,
`pr_number`, `issue_number`, `commit_sha`, `url`, and a `correlationId`.

---

## Outbound Safety

The outbound safety system (`src/review/outbound-safety.ts`) filters all
agent-generated content before it reaches external platforms. It is the last
line of defense before content is published.

### Purpose

Prevents agents from publishing content that:
- Leaks credentials (API keys, tokens, private keys, connection strings)
- Contains potential data exfiltration patterns
- Leaks internal information (agent names, system prompts, internal URLs)
- Violates brand voice guidelines

### Architecture

```
Agent generates content
    → submit_for_review (review:pending event)
    → Reviewer agent evaluates
    → OutboundSafetyFilter.check(content, platform, contentType)
        → Rule-based checks (regex patterns, keyword lists)
        → Severity classification (block, warn, info)
    → If blocked: content rejected, agent notified
    → If warnings: content flagged for human review
    → If clean: content approved for publication
```

### Safety Check Categories

| Category | What It Catches | Severity |
|---|---|---|
| Credential leaks | API keys (Anthropic, OpenAI, GitHub, Slack, AWS), private keys, JWTs, MongoDB/Redis URIs with credentials | BLOCK |
| Data exfiltration | Key-value credential assignments, connection strings with embedded passwords | BLOCK |

### Platform-Specific Rules

Different platforms have different content policies. The safety filter applies
platform-specific rules based on the `targetPlatform` parameter:
- **X (Twitter)**: Character limits
- **Telegram**: No forwarding instructions, no group invite spam
- **Instagram**: No link-in-bio spam patterns
- **Email**: CAN-SPAM compliance checks

### Integration Points

- Called by the `Reviewer` agent during the `review:pending` pipeline
- Can be invoked directly via `OutboundSafetyFilter.check()` for pre-flight checks
- Results are logged to the audit trail with full check details

---

## Repo Registry

The repo registry (`src/config/repo-registry.ts`) manages configuration for all
target repositories that agents can operate on.

### Dual-Source Architecture

```
repos/*.yaml (static, committed)     →  RepoRegistry (in-memory)
MongoDB repo_configs (dynamic, API)  →  ↑ merged, YAML takes precedence
```

**Static configs** (`repos/` directory): Human-managed YAML files committed to
yclaw. These take precedence over dynamic configs (human override).

**Dynamic configs** (MongoDB): Agent-registered at runtime via the `repo:register`
action. Solves the chicken-and-egg problem — agents can register new repos
without modifying yclaw (which is codegen-excluded).

### Repo Config Schema

Each repo config (`src/config/repo-schema.ts`) includes:

```yaml
name: my-app              # Unique registry name (kebab-case)
github:
  owner: YClawAI
  repo: my-app
  default_branch: main
  branch_prefix: agent/         # Prefix for agent-created branches
tech_stack:
  language: typescript
  framework: next               # next, express, static, etc.
  package_manager: pnpm         # npm, yarn, pnpm, bun
  build_command: pnpm build
  test_command: pnpm test
  lint_command: pnpm lint
risk_tier: auto                 # auto, guarded, critical
trust_level: sandboxed          # sandboxed (default), trusted
deployment:
  type: vercel                  # vercel, ecs, github-pages, none
  environments:
    dev: auto
    staging: auto
    production: auto
  vercel_project_id: prj_xxxxx  # Optional
  vercel_org_id: team_xxxxx     # Optional
codegen:
  preferred_backend: claude     # claude, codex, opencode
  timeout_minutes: 15
  max_workspace_mb: 500
  claude_md_path: CLAUDE.md
  frontend:                     # Optional: browser evidence capture
    browser_evidence: false
    base_url: http://localhost:3000
    smoke_paths: ["/"]
secrets:
  codegen_secrets: []           # Available during codegen
  deploy_secrets: []            # Deployer-only, never in codegen
  github_token_scope: contents_rw
metadata:
  description: "Landing page"
  primary_reviewers: ["architect"]
```

### Trust Levels

| Level | Install Command | Use Case |
|---|---|---|
| `sandboxed` (default) | `npm install --ignore-scripts` | Most repos — prevents install script exfiltration |
| `trusted` | `npm install` (full lifecycle) | Repos where you control all dependencies |

### Codegen Exclusion

The `yclaw` repo is excluded from **subprocess codegen** (self-modification
protection). `isRepoExcluded()` in `src/config/repo-loader.ts` blocks `codegen:execute`
and `codegen:direct` from operating on this repo. The registry still loads yclaw
so webhook handlers can process events from it. Direct GitHub API actions
(`github:get_contents`, `github:commit_batch`, etc.) are unaffected — those operate
via the GitHub API and are governed by the branch allowlist instead.

### Registry API

```typescript
registry.get(name)              // By registry name
registry.getByFullName(fullName) // By "owner/repo"
registry.getAll()               // All configs
registry.has(nameOrFullName)    // Check existence
registry.register(raw)          // Register new (persists to MongoDB)
```

### Adding a New Repo

**Option 1 — Static (recommended for permanent repos):**
Add a YAML file to `repos/{name}.yaml` and merge to master.

**Option 2 — Dynamic (for agent-bootstrapped repos):**
Call `repo:register` with the config object. Persists to MongoDB.
YAML configs always take precedence over dynamic configs.

---

## Task Registry

The task registry (`src/services/task-registry.ts`) tracks the lifecycle of
every task in the system using a state machine.

### Task State Machine

```
queued → in_progress → review → completed
                    ↘ blocked ↗     ↘ failed
                    ↘ ci_failed → in_progress
                    ↘ changes_requested → in_progress
```

**Stages:**

| Stage | Description | Terminal? |
|---|---|---|
| `queued` | Task created, waiting to start | No |
| `in_progress` | Agent is working on it | No |
| `review` | PR created, awaiting review | No |
| `ci_failed` | CI failed, needs fix | No |
| `changes_requested` | Review requested changes | No |
| `blocked` | Blocked on external dependency | No |
| `merged` | PR merged, awaiting deploy | No |
| `completed` | Done | Yes |
| `failed` | Failed permanently | Yes |
| `cancelled` | Cancelled | Yes |

### Atomic Transitions

Stage transitions use conditional updates — the store filters on the current
stage before updating. If two concurrent calls try to transition the same task,
only one succeeds. This prevents race conditions in the distributed agent system.

```typescript
registry.transition(taskId, 'in_progress', 'Builder started work');
registry.transition(taskId, 'review', 'PR #42 created');
registry.transition(taskId, 'completed', 'Merged and deployed');
```

### Task Store Backends

- `InMemoryTaskStore` — for testing
- `MongoTaskStore` — production backend with TTL eviction on completed tasks

### Correlation IDs

Every task carries a `correlationId` that traces it from creation through the
entire pipeline:

```
Issue opened → correlationId generated
    → Task created (same correlationId)
    → Builder triggered (correlationId in event payload)
    → PR created (correlationId in PR body)
    → CI runs (correlationId propagated)
    → Slack notifications (correlationId in metadata)
```

Correlation IDs enable end-to-end tracing across agents, events, and external
systems. They are generated at the entry point (webhook handler or API trigger)
and propagated through every event publish.

---

## Failure Recovery

### Circuit Breaker (Builder)

Builder tracks retry attempts per PR/branch in agent memory:
- Key: `retry_attempts:{repo_full}:{pr_number}`
- Max 3 attempts before escalating to human
- 60-second backoff between retries
- Each retry includes previous failure context

### Auto-Fix Scope Limits

Automated fixes (CI failure, review changes) are bounded:
- Max 5 files changed per fix attempt
- Max 200 lines changed per fix attempt
- Cannot modify immutable paths
- Cannot weaken tests, lint rules, or type checking

### Production URL Routing

`agents.yclaw.ai` serves Mission Control (UI) by default. API endpoints are path-routed.

| URL Pattern | Target | ALB Rule |
|-------------|--------|----------|
| `agents.yclaw.ai` | Mission Control (Next.js, port 3001) | Default action |
| `agents.yclaw.ai/api/*` | Agents API (Express, port 3000) | Priority 10 path rule |
| `agents.yclaw.ai/health` | Agents API | Priority 10 path rule |
| `agents.yclaw.ai/github/webhook` | Agents API | Priority 10 path rule |
| `agenthub.<INTERNAL_DOMAIN>:8080` | AgentHub (Go) | Internal ALB only |

**ECS Services:**
- `yclaw-production` → public ALB (`yclaw-production` TG)
- `yclaw-agenthub` → internal ALB (`yclaw-agenthub` TG)
- `yclaw-mc-production` → dual: internal ALB (`yclaw-mission-control-prod` TG) + public ALB (`yclaw-mc-public` TG)

**⚠️ DO NOT create `mc.yclaw.ai`.** `agents.yclaw.ai` is the canonical UI URL.

### Approval Gates (`approvals/gates.ts`)

Action-level approval gates are separate from the deploy risk classifier. Key decisions:

| Action | Risk Level | Requires Human | Rationale |
|--------|-----------|---------------|-----------|
| `deploy:execute` | high | **No** | Deploy governance pipeline (risk classifier → Architect review → hard gates → canary) provides sufficient gating. Human approval on top creates contradictory alerts. Changed from `critical/true` → `high/false` on 2026-03-21 after PR #456 incident. |
| `safety:modify` | critical | **Yes** | Modifying safety rails, outbound guards, review gates. Always requires human. |
| `cost:above_threshold` | high | **Yes** | Cost above $5 needs human sign-off. |
| `external:new_integration` | medium | **Yes** | New external integrations need human review. |

**Key principle:** Don't stack two parallel approval systems on the same action. The deploy pipeline already has Architect review for CRITICAL changes — adding a separate `requiresHuman: true` gate on `deploy:execute` creates a race where Architect approves and deploys while a stale "human approval required" alert lingers in Slack.

### Deploy Flood Protection

When multiple `github:ci_pass` events queue up (e.g., during an outage), all
pending deploy assessments could fire at once. Four Redis-backed layers prevent
this:

| Layer | Where | Key Pattern | TTL | What It Does |
|-------|-------|-------------|-----|--------------|
| **Event dedup** | `main.ts` event loop | `deploy:event-dedup:{repo_full}:{commit_sha}` | 30 min | Skips duplicate `deploy_assessment` triggers before Deployer LLM runs |
| **Assessment dedup** | `deploy:assess` | `deploy:dedup:{repo}:{env}:{commit_sha}` | 30 min | Returns existing `deployment_id` for identical re-assessments |
| **Execution lock** | `deploy:execute` | `deploy:exec-lock:{repo}:{env}` | 15 min | Max 1 concurrent production deploy per repo (covers canary window) |
| **Startup cleanup** | `main.ts` startup | MongoDB query | — | Cancels pending/approved deployments older than 30 min |

All layers are opt-in: if Redis is unavailable, deploys proceed without flood
protection (degraded mode, logged at startup).

---

## AO Input Handling — stdin / Prompt Flow

This section documents how AO passes task prompts to Claude Code to prevent
the "no stdin data received in 3s" / "Input must be provided either through
stdin or as a prompt argument when using --print" failures.

### Root Cause

Claude Code's `--print` / `--bare` flags expect either:
1. **Inline prompt** — passed via `-p <task>` on the command line, **or**
2. **Stdin** — piped data on the process stdin descriptor.

If neither is present, Claude waits ~3 s for stdin and then fails. AO always
uses option (1) to avoid any stdin dependency.

### How Runtime Process Delivers Prompts

```
AO assigns a task
    → ao-bridge-server.mjs spawns an ao session
        → agent plugin getLaunchCommand() builds: claude --bare -p "<task>" ...
        → runtime-process.mjs create() receives the launch command
            → _parseLaunchCommand()  splits into cmd + args
            → _hasInlinePrompt()     checks args for -p / --print <value>
            → If prompt present:     _spawn() immediately (inline -p used)
            → If no prompt yet:      defer — wait for sendMessage()
    → sendMessage(handle, task)
        → validates task is non-empty string (throws on empty/null/whitespace)
        → _buildOneShotArgs(cmd, task) rebuilds args with -p task
        → _warnIfStdinRequired()     logs diagnostic if -p still missing
        → _spawn() launches with inline -p — never blocks on stdin
```

### Key Invariants

| Invariant | Where enforced |
|---|---|
| `-p` is always set before spawning Claude | `_buildOneShotArgs` |
| Task must be non-empty before re-spawn | `sendMessage` guard |
| Defer spawn when no inline prompt at create time | `create()` guard |
| Warn if `--bare`/`--print` without `-p` | `_warnIfStdinRequired` |

### REDIS_URL

`REDIS_URL` must be set in the container environment for the AO queue store
(`ao-bridge-server.mjs` → `AoQueueStore.fromEnv()`) to persist job deduplication
and queue state across container restarts. Without it the bridge falls back to
an in-process memory queue (jobs are lost on restart).

Configure via ECS task definition environment variable `REDIS_URL`.

---

## Coding Guidelines

### Error Handling
- Fail fast with clear, actionable messages
- Never swallow exceptions silently
- Include context: what operation, what input, what failed
- `JSON.stringify(error)` produces `{}` — always extract `.message` and `.stack`

### Functions
- 100 lines per function maximum
- Cyclomatic complexity 8 or less
- 5 positional parameters maximum (use options object beyond that)
- 100-character line length

### Comments
- Code should be self-documenting
- No commented-out code — delete it
- Comments explain WHY, not WHAT

### Imports
- ESM imports with `.js` extensions
- Absolute imports from package root
- `import type` for type-only imports

### Dependencies
- Justify every new dependency
- Each dependency is attack surface and maintenance burden
- Prefer standard library over third-party when reasonable

### Commits
- Imperative mood, 72-character subject line maximum
- One logical change per commit
- Never push directly to `master`
- Never commit secrets or credentials
