## March 24, 2026

### SECURITY: LiteLLM Supply Chain Attack (PR #559)
- LiteLLM PyPI 1.82.7/1.82.8 compromised with credential-stealing `.pth` file
- Dockerfile pinned to `ghcr.io/berriai/litellm:main-v1.82.3-stable`
- `infra/litellm/SECURITY-HOLD.md` added with resume criteria
- DO NOT upgrade until BerriAI post-mortem + community verification + human sign-off

### feat: Pi-Coding-Agent SDK Integration (PR #560)
- New `PiCodingExecutor` backend using `@mariozechner/pi-coding-agent` SDK in-process
- Deny-by-default tool control: `tools: [] + customTools: [...]`
- 6 YClaw-safe custom tools: `yclaw-read`, `yclaw-write`, `yclaw-edit`, `yclaw-bash`, `yclaw-grep`, `yclaw-ls`
- Bash sandboxing: network blocked (curl/wget/nc), secrets scrubbed, ulimits (512MB/30s/100MB), workspace boundary enforced
- Event-based cost tracking via `PiCostBridge` (subscribes to session events, forwards to costTracker)
- `SessionManager.inMemory()` for Fargate (no disk persistence)
- Feature flag: `PI_CODING_AGENT_ENABLED=true` required
- New env var: `PI_CODING_AGENT_DIR=/tmp/pi-agent-config`
- `ExecutorHint` type expanded: `'cli' | 'pi'`
- New packages: `@mariozechner/pi-ai`, `@mariozechner/pi-coding-agent`
- Audit doc: `docs/integrations/pi-sdk-audit.md`

### fix: Task Lifecycle & Strategist Guards (PR #556)
- Builder Dispatcher wires task lifecycle to Task Registry on all terminal states
- No more ghost "pending" tasks in Redis for 72h
- Strategist flood guard: rejects `strategist:builder_directive` when Builder queue depth > 15

### fix: Registry ID Mismatch (PR #561)
- Resolve registry ID mismatch + upsert missing task records

### chore: Remove WhatIfSimulator (PR #557)
- Deleted `what-if-simulator.tsx` per CEO directive

## March 23, 2026

### feat: CI Config Validation Safety Net (PR #551)
- CI gate validates every YAML against Zod schema, fails build on bad configs
- Graceful degradation: `safeParse()` so one bad agent doesn't crash all 14
- `npm run validate-configs` standalone script for local validation

### feat: Google Stitch AI Integration (PR #479)
- `StitchClient`: JSON-RPC wrapper for `stitch.googleapis.com/mcp`
- 7 methods: `listProjects`, `createProject`, `generateScreen`, `editScreens`, `generateVariants`, `getScreen`, `listScreens`
- Designer workflow updated with Stitch generation path
- Design Studio UI component in Mission Control

### fix: Stitch Event Routing (PR #481)
- New event `strategist:design_generate` routes to Designer's Stitch workflow

### feat: PR/Issue Reconciliation Loop (PR #478)
- Self-healing loop runs every 10 minutes, detects 7 stuck states
- Detects: stale approvals, orphan PRs, stuck CI, abandoned tasks, stale reviews, zombie sessions, missed merges
- Emits events → ReactionsManager handles mutations
- Architectural fix for the March 22 death spiral

### fix: Builder Pipeline Death Spiral Fixes (PR #477)
- Timeout reduction: `implement_issue` 30→12min, `fix_ci_failure` 5→3min
- DLQ retry cap: 3 max + exponential backoff + `permanent: true` flag
- Circuit breaker cleanup: auto-close dead PRs after circuit trips
- Stale review detection rule
- All 968 tests passing

### fix: CI Webhook Job Classification (PR #468)
- Distinguishes Check vs Deploy CI failures via GitHub Jobs API
- Circuit breaker null-key fallback (prevents bypass when project key is null)

### feat: Elvis Pre-Check (PR #484)
- Deterministic heartbeat gating: zero-LLM pre-check before every heartbeat
- Queries Redis for pending work → no work = skip entirely ($0.00 cost)

### fix: Agent Autonomy Doctrine (PR #485)
- Eliminated implicit human gating from all core agent prompts
- Agents operate autonomously by default; human gates are explicit opt-in

### fix: Stitch Executor Wiring (PR #507)
- Wire `StitchExecutor` into action registry

## March 22, 2026

### fix: MC Docker Lockfile Patcher (PR #469)
- Skip Next.js lockfile patcher that crashes on npm@10.0.0

### fix: Chat Abort on New Message (PR #470)
- Streaming LLM responses automatically abort when user sends a new message

## March 21, 2026

### docs: Production URL Routing (PR #461)
- `agents.yclaw.ai` default → Mission Control
- Path rules `/api/*`, `/health`, `/github/webhook` → Agents API
- MC ECS service renamed to `yclaw-mc-production`

### feat: deploy:status Action (PR #460)
- Implemented `deploy:status` (was never built — Sentinel reported "unavailable" for 14 checks)

### fix: Remove Redundant Deploy Approval (PR #459)
- Removed double human approval gate on `deploy:execute`
- Deploy governance pipeline (risk-classifier → Architect review) is sufficient

### fix: Builder Circuit Breaker + DLQ Fixes (PR #456)
- Project-level circuit breaker: 3 failures in 2h = reject new tasks for that project
- DLQ `failedAt` timestamp: catches UUID-format correlation IDs that bypassed age-based expiry
- Pre-PR quality gate

### fix: MC UI Batch Fixes (PR #454)
- Entity arrow fix, merged fleet badges

### fix: Builder Repo Structure in Prompt (PR #453)
- Added repo structure to Builder's prompt + skills

## March 20, 2026

### fix: ReviewGate Fail-Open (PR #431)
- ReviewGate now fails-open by default with retry logic
- Integrated secret scanning into review gate

### fix: Organization Settings Drawer (PR #439)
- Restored 4-section Organization Settings drawer in Mission Control

### feat: Cost Approval Budget Mode (PR #425)
- Cost approval gate now respects budget tracking mode

### fix: DLQ Config + Orphan Recovery (PRs #449, #450)
- DLQ retries use current timeout config + auto-purge permanent entries
- Orphan recovery applies current timeout config

### fix: Remove Elvis, Increase Builder Timeouts (PR #448)
- Removed Elvis preflight check (replaced by deterministic pre-check)
- Increased Builder timeouts

### fix: Remove SoundToggle from Hive (PR #451)

## March 19, 2026

### feat: Multi-Operator Access Phase 1 (PRs #421, #422)
- Operator identity system (Zod schemas, MongoDB storage)
- API key auth (argon2id hashing, constant-time verification)
- Auth middleware: required on `/v1/*`, optional on `/api/*` (backward compat)
- 7 CRUD endpoints: invite, accept, me, list, revoke, rotate-key
- Operator management UI at `/operators`
- RBAC roles, scoped tasking, audit logging with 90-day TTL

## March 18, 2026

### feat: Open Source Packaging (PRs #419, #420)
- Pluggable `SecretBackend` interface: MongoDB (AES-256-GCM, default), Env Vars, Encrypted File
- `SECRET_BACKEND` env var to select backend
- Recipe CLI: `recipe:validate`, `recipe:list`, `recipe:test --dry-run`
- Makefile: `make self-wire-github`, `make self-wire-openai`, etc.
- Docker Compose for local dev
- CONTRIBUTING.md

### feat: OpenClaw Integration Tiers 2 & 3 (PRs #417, #418)
- Tier 2 recipes: Slack, Figma, enriched GitHub
- Tier 3 self-wiring: OpenClaw → Strategist → Builder → Deployer
- Wire route: `POST /api/connections/[id]/wire`
- SSE endpoint: `GET /api/connections/[id]/events`
- `ConnectionReporter` class for fleet agent → MC status updates

## Documentation Audit — 2026-03-13

- Replaced the root `README.md` with an architecture and operations overview that matches the current package, container, and deployment layout
- Added `CONTRIBUTING.md` with setup, verification, and governance guidance for contributors
- Expanded `.env.example` to document the runtime, dashboard, ACPX, AgentHub, and optional integration variables actually referenced in code
- Marked the prompt-caching wiring spec as implemented in `docs/issue-58-wiring-spec.md`

## Pipeline Smoke Test — 2026-03-03T14:18:33Z

Verifying end-to-end deploy pipeline after fixes:
- PR #274: github:compare_commits wiring
- PR #278: LiteLLM resilience (load balancing + fallbacks)
- PR #280: Deploy flood protection
- PR #282: ci_pass pr_url enrichment (fixes pr_required gate)


## Full Autonomy Smoke Test — 2026-03-03T15:27Z

Testing complete autonomous pipeline after PR #285 (EventBus multi-subscriber fix):
- EventBus handlers changed from Map<string, handler> to Map<string, handler[]>
- ReactionsManager + agent router now BOTH receive events (no overwrite)
- Promise.allSettled for error isolation between handlers

Expected: PR → Architect [APPROVED] comment → auto-merge → ci_pass → auto-deploy. Zero human touch.

## Slack Alert Dedup + DLQ Batching — 2026-03-04 (PR #309)

- SlackExecutor: Redis-based message dedup via SHA-256 fingerprinting
  - Normalizes volatile fields (UUIDs, timestamps, deploy IDs, counts)
  - Channel-specific TTLs: #yclaw-alerts 2hr, #yclaw-executive 1hr, dev/marketing 30min
  - Fail-open: Redis errors allow messages through
- BuilderDispatcher: DLQ alerts batched (5 entries or 60s flush)
- main.ts: Dedicated `slackDedupRedis` client passed to SlackExecutor
- 17 new tests in `slack-dedup.test.ts`

## Auto-Update Behind Branch — 2026-03-04 (PR #308)

- New reaction rule `auto-update-behind-branch`: auto-updates PR branches that
  fall behind master when strict checks are enabled
- `branch_up_to_date` safety gate added to all 3 merge rules
- Loop protection: max 3 updates per PR per hour via Redis counter

## Full Autonomy Smoke Test v3 — 2026-03-03T16:25Z

PR #290 (merge_pr param fix) is live. The REAL real test.
- v1 (#286): PR #285 not deployed yet
- v2 (#287): ReactionsManager fired but merge_pr missing owner/repo/pullNumber
- v3: All fixes live. Zero human intervention or bust.
