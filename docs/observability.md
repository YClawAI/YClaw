# Observability

System health monitoring, error taxonomy, audit timeline, metrics, and structured logging for YClaw.

Source: `packages/core/src/observability/`

---

## Health System

The `HealthAggregator` (`packages/core/src/observability/health.ts`) checks all infrastructure adapters and reports system status. Components are classified as **critical** (stateStore, eventBus) or **non-critical** (objectStore, channels). Only critical components determine overall system health.

### Three Health Tiers

#### 1. Liveness --- `GET /health`

Unauthenticated. Returns `200` if the process is alive. No dependency checks.

Registered before auth middleware in `packages/core/src/observability/health-routes.ts`.

```json
{ "status": "alive", "timestamp": "2026-04-03T00:00:00.000Z" }
```

#### 2. Readiness --- `GET /health/ready`

Unauthenticated. Returns `200` if critical dependencies (stateStore and eventBus) are healthy. Returns `503` otherwise.

```json
{ "ready": true, "timestamp": "2026-04-03T00:00:00.000Z" }
```

If infrastructure is not initialized, returns `503` with `{ "ready": false, "reason": "Infrastructure not initialized" }`.

#### 3. Detailed Health --- `GET /v1/observability/health`

Authenticated (root operator only). Returns full system breakdown. Registered in `packages/core/src/observability/observability-routes.ts`.

Response shape (`DetailedHealth` interface):

| Field | Type | Description |
|-------|------|-------------|
| `status` | `'healthy' \| 'degraded' \| 'unhealthy'` | Overall system status |
| `uptimeSeconds` | `number` | Process uptime via `process.uptime()` |
| `timestamp` | `string` | ISO 8601 timestamp |
| `components` | `Record<string, { status, latencyMs?, error? }>` | Infrastructure components (stateStore, eventBus, objectStore) |
| `channels` | `Record<string, { status, error? }>` | Channel health (`healthy`, `disabled`, or `unhealthy`) |
| `agents` | `{ total, active, idle, errored }` | Agent counts from run records (last hour) |
| `tasks` | `{ pending, running, failedLast24h }` | Task counts from `operator_tasks` collection |
| `recentErrors` | `Array<{ timestamp, errorCode?, message, agentId?, category?, severity?, action? }>` | Last 5 failed executions with enriched error code data |

**Status logic:**
- `unhealthy` --- any critical component (stateStore or eventBus) is down
- `degraded` --- all critical components healthy but a non-critical component (objectStore, channel) is down
- `healthy` --- all components healthy

---

## Error Taxonomy

Source: `packages/core/src/observability/error-codes.ts`

17 error codes across 5 categories with 3 severity levels. These are pure data (zero imports) so any layer can reference them without circular dependencies.

### Severity Levels

| Severity | Meaning |
|----------|---------|
| `critical` | System-level failure requiring immediate attention |
| `warning` | Degraded functionality, actionable |
| `info` | Informational, no action required |

### Error Codes by Category

#### Infrastructure (`infra`)

| Code | Severity | Action |
|------|----------|--------|
| `STATE_STORE_UNREACHABLE` | critical | Check database connection |
| `EVENT_BUS_UNREACHABLE` | critical | Check Redis connection |
| `MEMORY_STORE_UNREACHABLE` | warning | Memory system degraded, agents run without long-term memory |
| `OBJECT_STORE_UNREACHABLE` | warning | Check object store configuration |

#### LLM (`llm`)

| Code | Severity | Action |
|------|----------|--------|
| `LLM_TIMEOUT` | warning | Retry or switch provider |
| `LLM_RATE_LIMITED` | warning | Wait or reduce concurrency |
| `LLM_AUTH_FAILED` | critical | Check API key |
| `LLM_CONTEXT_OVERFLOW` | warning | Reduce input size or switch to a model with larger context |

#### Agent (`agent`)

| Code | Severity | Action |
|------|----------|--------|
| `AGENT_TASK_FAILED` | warning | Check task logs |
| `AGENT_CHECKPOINT_STALE` | info | Task may have been interrupted |
| `AGENT_BUDGET_EXCEEDED` | warning | Review agent budget config |
| `AGENT_NOT_FOUND` | warning | Check agent configuration and department assignments |

#### Security (`security`)

| Code | Severity | Action |
|------|----------|--------|
| `EVENT_SIGNATURE_INVALID` | critical | Possible event forgery attempt |
| `OPERATOR_AUTH_FAILED` | warning | Check operator API key |
| `PERMISSION_DENIED` | info | Operator lacks required permission |

#### Channel (`channel`)

| Code | Severity | Action |
|------|----------|--------|
| `CHANNEL_DISCONNECTED` | warning | Check channel credentials and connectivity |
| `CHANNEL_RATE_LIMITED` | info | Wait for rate limit reset |

### Lookup Helpers

```typescript
import { getErrorCode, getErrorCodesByCategory, getErrorCodesBySeverity } from './error-codes.js';

getErrorCode('LLM_TIMEOUT');                // { category: 'llm', severity: 'warning', action: '...' }
getErrorCodesByCategory('security');         // All security error codes
getErrorCodesBySeverity('warning');          // All codes at 'warning' or above (warning + critical)
```

---

## Audit Timeline

Source: `packages/core/src/observability/audit-timeline.ts`

The `AuditTimeline` class provides a unified query layer across two separate audit stores:

1. **OperatorAuditLogger** --- operator actions (API calls, permission decisions)
2. **AuditLog** --- execution audit (agent task runs, failures)

### How It Works

The `query()` method fans out to both stores in parallel, merges results by timestamp (descending) with a stable tiebreaker (source, then id), and applies cursor-based pagination.

### TimelineEvent Shape

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Synthetic ID (`op_<timestamp>_<index>` for operator, MongoDB `_id` for execution) |
| `timestamp` | `string` | ISO 8601 |
| `source` | `'operator' \| 'execution'` | Which audit store this came from |
| `operatorId` | `string?` | Present for operator events |
| `agentId` | `string?` | Present for execution events |
| `action` | `string` | What happened |
| `correlationId` | `string?` | Cross-system correlation |
| `resource` | `{ type, id }?` | Operator events only |
| `decision` | `'allowed' \| 'denied'?` | Operator events only |
| `status` | `string?` | Execution events only |
| `errorCode` | `string?` | Execution events only |
| `message` | `string?` | Error or reason text |

### Query Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `operatorId` | `string?` | --- | Filter to operator events for this ID (skips execution store) |
| `agentId` | `string?` | --- | Filter to execution events for this agent (skips operator store) |
| `correlationId` | `string?` | --- | Filter by correlation ID (execution store only) |
| `action` | `string?` | --- | Filter by action name |
| `before` | `string?` | --- | ISO timestamp cursor for pagination (exclusive) |
| `limit` | `number?` | 50 | Max events per page (capped at 200) |

### Pagination

Cursor-based. The response includes:

```json
{
  "events": [...],
  "cursor": "2026-04-03T12:00:00.000Z",
  "hasMore": true
}
```

Pass `cursor` as the `before` parameter on the next request. Each store fetches `limit + 1` records internally to determine `hasMore` after merge.

---

## Observability API

All 4 endpoints live under `/v1/observability/*` and require authenticated root operator. Registered in `packages/core/src/observability/observability-routes.ts`.

### `GET /v1/observability/health`

Detailed health. See [Detailed Health](#3-detailed-health----get-v1observabilityhealth) above.

### `GET /v1/observability/audit`

Audit timeline with cursor pagination.

| Query Param | Type | Description |
|-------------|------|-------------|
| `operatorId` | `string?` | Filter by operator |
| `agentId` | `string?` | Filter by agent |
| `correlationId` | `string?` | Filter by correlation ID |
| `action` | `string?` | Filter by action |
| `before` | `string?` | ISO timestamp cursor (validated) |
| `limit` | `string?` | Positive integer (validated) |

Returns `TimelineResponse` with `events`, `cursor`, and `hasMore`.

### `GET /v1/observability/errors`

Recent failed executions with enriched error code data.

| Query Param | Type | Default | Description |
|-------------|------|---------|-------------|
| `since` | `string?` | all time | Duration filter: `30m`, `1h`, `24h`, `7d` (pattern: `<number><m\|h\|d>`) |
| `limit` | `string?` | 20 | Max results (capped at 100) |

Returns `{ errors: [...], count: number }`. Each error includes `timestamp`, `errorCode`, `message`, `agentId`, `category`, `severity`, and `action` (from the error taxonomy).

### `GET /v1/observability/summary`

Quick system summary designed for AI assistants.

```json
{
  "status": "healthy",
  "uptimeSeconds": 3600,
  "ready": true,
  "componentCount": 3,
  "unhealthyComponents": [],
  "timestamp": "2026-04-03T00:00:00.000Z"
}
```

No query parameters. Returns a minimal payload suitable for LLM tool use.

---

## Metrics

Source: `packages/core/src/observability/metrics.ts`

The `IMetrics` interface provides a pluggable metrics abstraction. Call sites instrument counters, histograms, and gauges without coupling to a backend.

### Interface

```typescript
interface IMetrics {
  incrementCounter(name: string, labels?: Record<string, string>, value?: number): void;
  observeHistogram(name: string, value: number, labels?: Record<string, string>): void;
  setGauge(name: string, value: number, labels?: Record<string, string>): void;
}
```

### Default: `NoopMetrics`

The default implementation discards all metrics. Zero overhead, zero dependencies. Swap in a `PrometheusMetrics` or OpenTelemetry adapter when needed.

---

## Structured Logging

Source: `packages/core/src/observability/log-context.ts`

### LogContext Interface

All fields are optional. Include what is available at the call site.

| Field | Type | Description |
|-------|------|-------------|
| `correlationId` | `string?` | End-to-end trace across agents, events, external systems |
| `operatorId` | `string?` | Which operator triggered the action |
| `agentId` | `string?` | Which agent is executing |
| `department` | `string?` | Agent department |
| `taskId` | `string?` | Task being worked on |
| `errorCode` | `ErrorCode?` | From the error taxonomy |
| `durationMs` | `number?` | Operation duration |
| `[key: string]` | `unknown` | Arbitrary additional metadata |

### `buildLogMeta(ctx: LogContext)`

Strips `undefined` values from a `LogContext` so Winston/JSON.stringify produces clean output. Use this to convert a `LogContext` into a metadata object for structured log calls.

---

## CLI Status Command

Source: `packages/cli/src/commands/status.ts`

```
yclaw status [--json] [--verbose] [--api-url <url>] [--api-key <key>]
```

Fetches `GET /v1/observability/health` and renders the detailed health response.

### Exit Codes

| Code | Meaning |
|------|---------|
| `0` | System healthy |
| `1` | System degraded |
| `2` | Unreachable, auth error, or API error |

### API Key Resolution Chain

1. `--api-key` flag
2. `YCLAW_ROOT_API_KEY` environment variable
3. `.env` file (loaded via `loadProjectEnv()`)

### API URL Resolution Chain

1. `--api-url` flag
2. `YCLAW_API_URL` environment variable
3. Config `networking.apiPort` (via `resolveApiPort()`)
4. `http://localhost:3000` (default)

### Output Modes

- **Default**: Human-readable table with status icons, infrastructure, channels, agents, tasks, and recent errors with suggested fix actions
- **`--json`**: Full `DetailedHealth` JSON for machine consumption
- **`--verbose`**: Includes disabled channels (hidden by default)

---

## Mission Control Observability Page

Source: `packages/mission-control/src/app/observability/`

The Observability page in Mission Control (`/observability`) provides a dashboard view with four panels:

| Panel | Component | Data Source |
|-------|-----------|-------------|
| System Health | `HealthOverview` | `GET /v1/observability/health` |
| System Stats | `SystemStats` | agents + tasks from health response |
| Recent Errors | `ErrorSummary` | `recentErrors` from health response |
| Audit Timeline | `AuditTimeline` | `GET /v1/observability/audit?limit=20` |

Auto-refreshes health data every 30 seconds. Requires root operator authentication. Initial data is fetched server-side (Next.js RSC), then the client component polls `/api/observability/health` for updates.
