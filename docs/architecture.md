# YClaw Architecture

> Last verified against source: 2026-04-03

---

## 1. System Overview

```
                         agents.yclaw.ai
                               |
                          [ ALB Rules ]
                         /             \
                        /               \
     /api/* /health /github/*     Default (all other paths)
                |                        |
                v                        v
  +---------------------------+   +---------------------------+
  |     Core Runtime          |   |    Mission Control        |
  |     (Express, port 3000)  |   |    (Next.js 14, port 3001)|
  |     packages/core/        |   |    packages/mission-control/
  |                           |   |                           |
  |  Agent Executor           |   |  Dashboard UI             |
  |  Action Registry          |   |  Operator Management      |
  |  Event Bus                |   |  Fleet Overview            |
  |  Webhook Handlers         |   |  Audit Trail Viewer        |
  |  Builder Dispatcher       |   |                           |
  |  Reactions Manager        |   +---------------------------+
  |  Cron Manager             |
  |  Operator API (v1)        |
  +-----|-----------|----------+
        |           |
        v           v
  +-----------+  +-----------+  +---------------+
  |  MongoDB  |  |   Redis   |  |  PostgreSQL   |
  |  (Atlas)  |  |  (Cloud)  |  | (MEMORY_DB)   |
  |           |  |           |  |               |
  | Audit log |  | Pub/sub   |  | Memory items  |
  | Executions|  | Event bus |  | Triples       |
  | Agent mem |  | Cron locks|  | Episodes      |
  | Costs     |  | Task queue|  | Checkpoints   |
  | Configs   |  | DLQ       |  | Working mem   |
  | Approvals |  | Dedup keys|  | Write gate    |
  | Tasks     |  | Escalation|  | Resources     |
  | Operators |  | Fleet grd |  |               |
  +-----------+  +-----------+  +---------------+

  Channels (outbound/inbound):
  +--------+ +----------+ +---------+ +--------+ +---------+
  | Slack  | | Telegram | | Twitter | | GitHub | | Discord |
  +--------+ +----------+ +---------+ +--------+ +---------+
```

**Entry point:** `packages/core/src/main.ts`

**Runtime:** TypeScript monorepo (Turborepo + npm workspaces), Node 20 LTS, ESM modules.

---

## 2. Interface / Adapter Pattern

Every infrastructure component is accessed through an abstract interface. The core
runtime imports only from `packages/core/src/interfaces/`. Concrete implementations
live in `packages/core/src/adapters/`.

### Interfaces

| Interface | File | Purpose |
|-----------|------|---------|
| `IStateStore` | `src/interfaces/IStateStore.ts` | Document storage (collections, CRUD, indexes) |
| `IEventBus` | `src/interfaces/IEventBus.ts` | Pub/sub, KV ops, sorted-set ops |
| `IChannel` | `src/interfaces/IChannel.ts` | Send/receive messages on external platforms |
| `ISecretProvider` | `src/interfaces/ISecretProvider.ts` | Credential resolution |
| `IObjectStore` | `src/interfaces/IObjectStore.ts` | File/blob storage (put, get, list, delete) |
| `IMemoryStore` | `src/interfaces/IMemoryStore.ts` | Structured memory (items, triples, episodes, search) |

All interfaces are re-exported from `src/interfaces/index.ts`.

### Concrete Adapters

| Interface | Adapter | File |
|-----------|---------|------|
| `IStateStore` | `MongoStateStore` | `src/adapters/state/MongoStateStore.ts` |
| `IEventBus` | `RedisEventBus` | `src/adapters/events/RedisEventBus.ts` |
| `IChannel` | `SlackChannelAdapter` | `src/adapters/channels/SlackChannelAdapter.ts` |
| `IChannel` | `TelegramChannelAdapter` | `src/adapters/channels/TelegramChannelAdapter.ts` |
| `IChannel` | `TwitterChannelAdapter` | `src/adapters/channels/TwitterChannelAdapter.ts` |
| `IChannel` | `DiscordChannelAdapter` | `src/adapters/channels/DiscordChannelAdapter.ts` |
| `ISecretProvider` | `EnvSecretProvider` | `src/adapters/secrets/EnvSecretProvider.ts` |
| `ISecretProvider` | `AwsSecretsProvider` | `src/adapters/secrets/AwsSecretsProvider.ts` |
| `IObjectStore` | `LocalFileStore` | `src/adapters/storage/LocalFileStore.ts` |
| `IObjectStore` | `S3ObjectStore` | `src/adapters/storage/S3ObjectStore.ts` |

The `Infrastructure` type (`src/infrastructure/types.ts`) bundles all resolved adapters:

```typescript
interface Infrastructure {
  stateStore: IStateStore;
  eventBus: IEventBus;
  channels: Map<string, IChannel>;
  secrets: ISecretProvider;
  objectStore: IObjectStore;
}
```

---

## 3. Monorepo Structure

```
yclaw/
├── packages/
│   ├── core/                 # Runtime engine (Express server, agent executor,
│   │   └── src/              #   actions, triggers, reactions, builder, codegen,
│   │       ├── actions/      #   LLM providers, review gates, safety, operators)
│   │       ├── adapters/     #   Concrete adapter implementations
│   │       ├── agent/        #   Executor, router, context, manifest
│   │       ├── builder/      #   Dispatcher, worker, task queue
│   │       ├── bootstrap/    #   services.ts, actions.ts, agents.ts, routes.ts
│   │       ├── codegen/      #   CLI/Pi coding backends
│   │       ├── config/       #   YAML loader, repo registry, schemas
│   │       ├── infrastructure/  # InfrastructureFactory, config-schema
│   │       ├── interfaces/   #   Abstract interfaces (IStateStore, IEventBus, etc.)
│   │       ├── llm/          #   Provider abstraction (Anthropic, OpenRouter, LiteLLM)
│   │       ├── operators/    #   RBAC operator model
│   │       ├── reactions/    #   GitHub lifecycle automation rules
│   │       ├── review/       #   Review gate, outbound safety
│   │       ├── security/     #   Event bus HMAC signing, credential guards
│   │       ├── self/         #   Self-modification tools, agent memory
│   │       ├── services/     #   Task registry, event stream
│   │       ├── triggers/     #   Cron, event bus, webhooks (GitHub, Slack, Telegram)
│   │       └── main.ts       #   Application entry point
│   ├── cli/                  # Installer CLI — guided setup, validation, deployment
│   │   └── src/              #   (bin: `yclaw`)
│   │       ├── commands/
│   │       ├── wizard/
│   │       ├── validators/
│   │       └── deploy/
│   ├── memory/               # Persistent memory system (PostgreSQL-backed)
│   │                         #   Categories, items, triples, episodes, embeddings
│   └── mission-control/      # Next.js 14 dashboard UI (port 3001, separate ECR image)
│                             #   Operator management, fleet view, audit trail
├── departments/              # Agent YAML configs (12 agents, 6 departments)
├── prompts/                  # System prompt markdown files
├── repos/                    # Target repository YAML configs
├── skills/                   # Per-agent learned skills (Claudeception)
├── vault/                    # Obsidian knowledge vault
├── infra/                    # Infrastructure configs (LiteLLM)
└── scripts/                  # Dev and seed scripts
```

**Build tooling:** `turbo.json` (Turborepo), `package.json` (npm workspaces).

---

## 4. Data Flow

```
  Trigger
  (cron / event / webhook / manual)
        |
        v
  Config Loader
  (YAML agent config + system prompts + memory categories)
        |
        v
  Data Resolver
  (fetch live data sources defined in agent YAML)
        |
        v
  Manifest + Context Builder
  (agent identity, org chart, history, prompt caching)
        |
        v
  LLM Call
  (Anthropic / OpenRouter / LiteLLM, max 25 tool rounds)
        |
        +---> Tool call: Action
        |       |
        |       v
        |     Permission check (agent's actions list)
        |       |
        |       v
        |     Outbound Safety Gate (credential / exfil patterns)
        |       |
        |       v
        |     Approval Gate (high-impact actions)
        |       |
        |       v
        |     Action Executor (github, slack, twitter, codegen, deploy, ...)
        |       |
        |       v
        |     Audit Log (MongoDB)
        |
        +---> Tool call: submit_for_review
        |       |
        |       v
        |     Review Gate (brand review via Reviewer agent)
        |       |
        |       v
        |     Outbound Safety Filter (regex patterns, keyword lists)
        |       |
        |       v
        |     Approve / Flag / Block
        |
        +---> Tool call: self-modification
                |
                v
              Safety Gate evaluation
```

**Key files:**

| Step | File |
|------|------|
| Config loading | `src/config/loader.ts` |
| Data resolution | `src/data/` |
| Manifest building | `src/agent/manifest.ts` |
| Context assembly | `src/agent/context.ts` |
| LLM execution loop | `src/agent/executor.ts` |
| Action dispatch | `src/actions/registry.ts` |
| Review gate | `src/review/reviewer.ts` |
| Outbound safety | `src/review/outbound-safety.ts` |
| Audit logging | `src/logging/audit.ts` |

---

## 5. Agent Execution Model

### YAML Configuration

Each agent is defined by a YAML file at `departments/<department>/<agent>.yaml`.
Schema validated by Zod (`src/config/schema.ts`).

Key fields: `name`, `department`, `model`, `system_prompts`, `triggers`, `actions`,
`event_subscriptions`, `event_publications`, `review_bypass`, `data_sources`.

### 6 Departments, 12 Agents

| Department | Agents | Focus |
|------------|--------|-------|
| **Executive** | strategist, reviewer | Strategy, brand review |
| **Development** | architect, designer | Code review, design enforcement |
| **Marketing** | ember, forge, scout | Content, assets, intelligence |
| **Operations** | sentinel, librarian | System health, knowledge management |
| **Finance** | treasurer | Treasury monitoring, spend tracking |
| **Support** | guide, keeper | User support, community moderation |

### Trigger Types

- **cron** -- Scheduled execution (UTC). Redis `SET NX` locks prevent duplicates.
- **event** -- Internal event bus subscription (`source:type` pattern).
- **webhook** -- HTTP endpoint (GitHub, Slack, Telegram).
- **batch_event** -- Collect N events or wait timeout, then fire.
- **manual** -- API-triggered execution.

Each trigger can override `model` and `prompts` independently.

---

## 6. Event Bus

**Transport:** Redis pub/sub on channel `agent:events`, with Redis Streams for durability.

**Pattern matching:** Events follow `source:type` format (e.g., `builder:pr_ready`).
Supports wildcards (`*:*`, `forge:*`, `*:asset_ready`).

**Fallback:** Local in-process dispatch when Redis is unavailable (single-instance mode).

### HMAC-SHA256 Signed Envelopes

All inter-agent events use signed envelopes (`src/security/eventbus/envelope.ts`).
The signature covers all fields including the payload to prevent tampering.

```
EventEnvelope {
  id, type, source, subject, timestamp, nonce, schemaVersion,
  payload: { ... },
  auth: { alg: "hmac-sha256", keyId, sig }
}
```

Per-agent HMAC keys are derived from a master secret using HKDF
(`src/security/eventbus/keys.ts`). A 6-stage validation middleware
(`src/security/eventbus/index.ts`) verifies inbound events.

**Webhook signature verification:**

| Source | Method | File |
|--------|--------|------|
| GitHub | HMAC-SHA256 (`x-hub-signature-256`) | `src/triggers/webhook.ts` |
| Slack | HMAC-SHA256 (`x-slack-signature`) | `src/triggers/slack-webhook.ts` |

---

## 7. Operator Model

4-tier RBAC system defined in `src/operators/types.ts`.

| Tier | Priority | Capabilities |
|------|----------|--------------|
| `root` | 100 | Full system access, operator management |
| `department_head` | 70 | Department-scoped agent control |
| `contributor` | 50 | Task submission, limited actions |
| `observer` | 10 | Read-only access |

**Authentication:** API key hash + optional Tailscale node binding.

**Authorization:** Tier-based hierarchy, department scoping, role IDs, cross-department
policy (`request` or `none`).

**Operational limits per operator:** `requestsPerMinute`, `maxConcurrentTasks`,
`dailyTaskQuota`.

**Key files:**

| Component | File |
|-----------|------|
| Operator schema | `src/operators/types.ts` |
| Operator store | `src/operators/operator-store.ts` |
| Role definitions | `src/operators/roles.ts` |
| Root seeding | `src/operators/seed.ts` |
| Audit logger | `src/operators/audit-logger.ts` |
| Rate limiter | `src/operators/rate-limiter.ts` |
| Task locks | `src/operators/task-locks.ts` |
| Cross-dept coordination | `src/operators/cross-dept.ts` |

---

## 8. Bootstrap Sequence

`main.ts` runs a 5-phase startup:

```
Phase 0: Infrastructure Layer
  InfrastructureFactory.loadConfig()    -- reads yclaw.config.yaml (or env defaults)
  InfrastructureFactory.create(config)  -- creates adapters:
    1. ISecretProvider   (EnvSecretProvider or AwsSecretsProvider)
    2. IStateStore       (MongoStateStore)       -- parallel
    3. IEventBus         (RedisEventBus)         -- parallel
    4. IObjectStore      (LocalFileStore or S3)  -- parallel
    5. IChannel[]        (Slack, Telegram, Twitter, Discord)
    -> Returns Infrastructure { stateStore, eventBus, channels, secrets, objectStore }
    -> Partial-failure cleanup: disconnects already-connected resources if any fail

Phase 1: initServices(infrastructure)
  Wires ServiceContext from infrastructure adapters:
    - AuditLog (MongoDB)
    - AgentMemory + MemoryIndex (MongoDB)
    - EventBus (Redis pub/sub)
    - EventStream (Redis Streams)
    - RepoRegistry (YAML + MongoDB dual-source)
    - MemoryManager (PostgreSQL via packages/memory)
    - CostTracker + BudgetEnforcer
    - CheckpointManager
    - FleetGuard
    - SettingsOverlay
    - OperatorStore + RoleStore + OperatorAuditLogger
    - OperatorTaskStore + TaskLockManager
    - CrossDeptStore + OperatorEventStream
    - OperatorRateLimiter + OperatorSlackNotifier
    - OnboardingService + IngestionService + ValidationRunner
    - Metrics (NoopMetrics by default)
    - AuditTimeline

Phase 2: initActions(services)
  Registers ActionExecutors:
    twitter, telegram, slack, github, email, event,
    codegen, deploy, repo, x, flux, figma, video, task

Phase 3: initAgents(services, actions)
  Creates:
    - AgentExecutor, ApprovalManager, ObjectiveManager
    - StaleLoopDetector, RevisionTracker
    - AgentRouter (loads all YAML configs)
    - BuilderDispatcher (if builder config + Redis exist)
    - ReactionsManager (if REACTION_LOOP_ENABLED=true)
    - CronManager (registers all cron triggers)
    - Event subscriptions for all agents
    - Batch event collection
    - Exploration module, Growth engine (optional)

Phase 4: initRoutes(services, actions, agents)
  Starts Express webhook server:
    - GitHub webhook handler (POST /github/webhook)
    - Slack webhook handler (POST /slack/events)
    - Telegram handler (webhook or polling)
    - Operator API routes (v1)
    - Health endpoint (GET /health)

Graceful Shutdown: 3-phase (stop accepting -> drain 15s -> close connections), 28s forced exit.
```

All paths referenced above are relative to `packages/core/src/`.
