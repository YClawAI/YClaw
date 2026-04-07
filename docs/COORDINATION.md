# Coordination Events Architecture

> Full reference for the `YClawEvent<T>` envelope, Redis Streams transport,
> event bridge mappings, and Journaler GitHub ledger.

---

## Overview

The coordination event system provides a durable, typed messaging layer for
cross-agent coordination. It runs alongside the existing Redis pub/sub EventBus
in **dual-mode**:

- **Pub/sub** (legacy): In-process fan-out, fire-and-forget, best for real-time
  notifications. Existing subscribers are unaffected.
- **Redis Streams** (new): Durable, replayable, at-least-once delivery via
  consumer groups. Use for coordination events that must not be lost.

All coordination events use the `YClawEvent<T>` envelope — a typed, correlated
event structure with causation tracking.

```
Agent A (source)
    → createEvent<CoordTaskPayload>({...})
    → eventBus.publishCoordEvent(event)
        → EventStream.publishEvent()
            → XADD yclaw:stream:coord MAXLEN ~ 10000 * data {json}

Agent B (consumer)
    → eventStream.subscribeStream('coord', 'my-group', handler)
        → XREADGROUP GROUP my-group consumer BLOCK 5000 STREAMS yclaw:stream:coord >
        → handler(event)
        → XACK on success
```

---

## Event Envelope

Every coordination event is wrapped in a `YClawEvent<T>` envelope:

```typescript
interface YClawEvent<T> {
  id: string;              // UUID v4 — unique event identifier
  type: string;            // Dot-namespaced (e.g. "coord.task.requested")
  source: string;          // Agent name that emitted this event
  target: string | null;   // Target agent, '*' for broadcast, null for untargeted
  correlation_id: string;  // Ties all events in a workflow together
  causation_id: string | null; // ID of the parent event that caused this one
  timestamp: string;       // ISO-8601 UTC
  schema_version: 1;       // Envelope version (always 1)
  payload: T;              // Typed event payload
  metadata?: Record<string, unknown>; // Optional arbitrary metadata
}
```

### Factory Function

```typescript
import { createEvent } from '../types/events.js';
import type { CoordTaskPayload } from '../types/events.js';

const event = createEvent<CoordTaskPayload>({
  type: COORD_TASK_REQUESTED,
  source: 'builder',
  correlation_id: task.correlationId,
  payload: {
    task_id: task.id,
    project_id: task.correlationId,
    status: 'requested',
    description: task.taskName,
  },
});
```

`createEvent()` auto-generates `id` (UUID), `timestamp` (ISO-8601), and sets
defaults for `target` (null) and `causation_id` (null).

---

## Payload Types

### CoordTaskPayload

Task lifecycle events — from request through completion or failure.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `task_id` | `string` | Yes | Task identifier |
| `project_id` | `string` | Yes | Project/correlation identifier |
| `status` | `CoordTaskStatus` | Yes | `requested` \| `accepted` \| `started` \| `blocked` \| `completed` \| `failed` |
| `description` | `string` | No | Human-readable task description |
| `assignee` | `string` | No | Agent assigned to the task |
| `artifact_url` | `string` | No | URL to the produced artifact (PR, doc, etc.) |
| `message` | `string` | No | Status message or error detail |

### CoordReviewPayload

Review lifecycle — requested, approved, or changes requested.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `task_id` | `string` | Yes | Task being reviewed |
| `reviewer` | `string` | Yes | Reviewing agent name |
| `status` | `CoordReviewStatus` | Yes | `requested` \| `approved` \| `changes_requested` |
| `feedback` | `string` | No | Review feedback text |

### CoordDeliverablePayload

Deliverable submission — PR created, doc published, design uploaded.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `task_id` | `string` | Yes | Task that produced this deliverable |
| `submitter` | `string` | Yes | Agent that created the deliverable |
| `artifact_type` | `string` | Yes | `pr` \| `doc` \| `design` \| `report` |
| `artifact_url` | `string` | Yes | URL to the deliverable |

### CoordProjectPayload

Project-level milestones — kickoff, phase completion, project close.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `project_id` | `string` | Yes | Project identifier |
| `status` | `CoordProjectStatus` | Yes | `kicked_off` \| `phase_completed` \| `completed` |
| `phase` | `string` | No | Current phase name |
| `agents` | `string[]` | No | Agents involved |
| `summary` | `string` | No | Status summary |

---

## Event Types (14 Constants)

All constants are exported from `packages/core/src/types/events.ts`:

### Task Lifecycle

| Constant | Value | When |
|----------|-------|------|
| `COORD_TASK_REQUESTED` | `coord.task.requested` | Task queued for execution |
| `COORD_TASK_ACCEPTED` | `coord.task.accepted` | Agent accepted the task |
| `COORD_TASK_STARTED` | `coord.task.started` | Worker began execution |
| `COORD_TASK_BLOCKED` | `coord.task.blocked` | Task blocked on dependency |
| `COORD_TASK_COMPLETED` | `coord.task.completed` | Task finished successfully |
| `COORD_TASK_FAILED` | `coord.task.failed` | Task failed (error or timeout) |

### Review Lifecycle

| Constant | Value | When |
|----------|-------|------|
| `COORD_REVIEW_REQUESTED` | `coord.review.requested` | Review requested from agent |
| `COORD_REVIEW_COMPLETED` | `coord.review.completed` | Review submitted |

### Deliverable Lifecycle

| Constant | Value | When |
|----------|-------|------|
| `COORD_DELIVERABLE_SUBMITTED` | `coord.deliverable.submitted` | Deliverable (PR, doc) created |
| `COORD_DELIVERABLE_APPROVED` | `coord.deliverable.approved` | Deliverable approved |
| `COORD_DELIVERABLE_CHANGES_REQUESTED` | `coord.deliverable.changes_requested` | Changes requested on deliverable |

### Project Lifecycle

| Constant | Value | When |
|----------|-------|------|
| `COORD_PROJECT_KICKED_OFF` | `coord.project.kicked_off` | Project started |
| `COORD_PROJECT_PHASE_COMPLETED` | `coord.project.phase_completed` | Phase milestone reached |
| `COORD_PROJECT_COMPLETED` | `coord.project.completed` | Project fully complete |

---

## Redis Streams Architecture

### Stream Keys

Stream keys are derived from the event type prefix (first dot-segment):

```
coord.task.requested  → yclaw:stream:coord
coord.review.completed → yclaw:stream:coord
builder.pr_ready      → yclaw:stream:builder
```

Pattern: `yclaw:stream:{prefix}` — all `coord.*` events share one stream.

### Stream Capacity

Each stream is capped at ~10,000 entries via `XADD ... MAXLEN ~ 10000`. The `~`
allows Redis to trim approximately (more efficient than exact trimming). This is
**not** an audit log — use MongoDB audit log for permanent records.

### Consumer Groups

Consumer groups are created on boot via `XGROUP CREATE ... MKSTREAM`:

- `MKSTREAM` auto-creates the stream if it doesn't exist
- `BUSYGROUP` errors (group already exists) are silently handled
- Consumer name defaults to `hostname()` for single-container deployments

### Read Loop

```
Boot
  → ensureGroup(key, group)     # XGROUP CREATE ... 0 MKSTREAM
  → processPending(key, group)  # XREADGROUP ... STREAMS key 0  (PEL replay)
  → while (!shutdown):
      XREADGROUP GROUP group consumer
        COUNT 10 BLOCK 5000
        STREAMS key >           # Only new entries
      → for each entry:
          parse JSON → handler(event)
          → success: XACK
          → failure: leave in PEL for retry
```

### PEL Replay (Crash Recovery)

On startup, pending entries (PEL) are replayed **before** reading new entries.
This ensures at-least-once delivery — if a handler crashes mid-processing, the
entry stays in the PEL and is retried on next boot.

**Consumers must be idempotent.** The same event may be delivered more than once.

### Dedicated Reader Connections

`XREADGROUP BLOCK` ties up the Redis connection for the duration of the block.
Each `subscribeStream()` call creates a dedicated reader via `redis.duplicate()`
to avoid blocking other Redis operations.

---

## Publishing Events

### Fire-and-Forget Pattern

Coordination events are published via `eventBus.publishCoordEvent()`. This
method is fire-and-forget: failures are logged but never thrown, and the call
is wrapped in `void` to avoid blocking the main execution path.

```typescript
// From packages/core/src/builder/dispatcher.ts
void this.deps.eventBus.publishCoordEvent(
  createEvent<CoordTaskPayload>({
    type: COORD_TASK_STARTED,
    source: 'builder',
    correlation_id: task.correlationId,
    payload: {
      task_id: task.id,
      project_id: task.correlationId,
      status: 'started',
      assignee: 'builder',
      description: task.taskName,
    },
  }),
);
```

### EventBus.publishCoordEvent()

```typescript
async publishCoordEvent(event: YClawEvent<unknown>): Promise<void> {
  if (!this.eventStream) return;  // No-op if EventStream not wired
  try {
    await this.eventStream.publishEvent(event);
  } catch (err) {
    this.log.warn('Failed to publish coord event (non-fatal)', { ... });
  }
}
```

---

## Consuming Events

```typescript
eventStream.subscribeStream('coord', 'my-agent-group', async (event) => {
  // event is YClawEvent<unknown> — narrow the type based on event.type
  if (event.type === COORD_TASK_COMPLETED) {
    const payload = event.payload as CoordTaskPayload;
    // Process completed task...
  }
  // Handler return = success → auto-XACK
  // Handler throw  = failure → stays in PEL for retry
});
```

---

## Current Emitters

### Builder Dispatcher (4 lifecycle events)

| Event | When | Payload Fields |
|-------|------|----------------|
| `coord.task.requested` | Task enqueued via `handleEvent()` | task_id, project_id, status=requested, description |
| `coord.task.started` | Worker picks up task in `dispatchNext()` | task_id, project_id, status=started, assignee=builder |
| `coord.task.completed` | Worker returns success in `runWorker()` | task_id, project_id, status=completed |
| `coord.task.failed` | Worker returns failure or throws in `runWorker()` | task_id, project_id, status=failed, message |

### main.ts Bridges (2 mappings)

Legacy pub/sub events are bridged to typed coordination events:

| Pub/Sub Event | Coord Event | Payload |
|---------------|-------------|---------|
| `builder:pr_ready` | `coord.deliverable.submitted` | submitter=builder, artifact_type=pr, artifact_url from event |
| `architect:pr_review` (approved) | `coord.review.completed` | reviewer=architect, status=approved |
| `architect:pr_review` (changes_requested) | `coord.review.completed` | reviewer=architect, status=changes_requested |
| `github:issue_closed` (PR #345) | `coord.task.completed` | Task cleanup — closes associated task records when linked issue is closed |

### Recent Event Additions

| PR | Event / Feature | Description |
|----|----------------|-------------|
| #337 | Session checkpoint events | ACP session state persisted to Redis on detach; restored on reattach after rolling deploys |
| #345 | `issue_closed` → task cleanup | When an issue is closed, associated task records in the TaskRegistry are transitioned to `completed` |
| #350 | Task hierarchy events | Parent-child task relationships tracked via `correlation_id` chains; enables cascade completion |

---

## Journaler (GitHub Coordination Ledger)

The Journaler (`src/modules/journaler.ts`) subscribes to `coord.*` events via
Redis Streams consumer group `journaler` and posts milestone events as formatted
Markdown comments on GitHub project issues.

### Event Classification

| Category | Event Types | Action |
|---|---|---|
| **Milestone** (10 types) | `coord.deliverable.{submitted,approved,changes_requested}`, `coord.review.completed`, `coord.task.{blocked,completed,failed}`, `coord.project.{kicked_off,phase_completed,completed}` | Post GitHub comment |
| **Noise** (3 types) | `coord.task.{requested,accepted,started}` | Silently ignored |
| **Status** | `coord.status.*` | Silently ignored |

### Issue Mapping

```
correlation_id → GitHub issue number
  stored in Redis hash: journaler:project_issues
  TTL: 30 days
```

1. `coord.project.kicked_off` → create `[Project] {name}` issue, store mapping
2. Subsequent events with same `correlation_id` → comment on mapped issue
3. No mapping found → fall back to default `[Coordination] Event Log` issue
   (created once, cached in Redis key `journaler:default_issue`)

### Comment Format

```markdown
<!-- yclaw-journaler -->
🛠️ **[Builder]** completed task — Implemented feature X
**Artifact:** [link](https://github.com/...pr/123)
**Correlation:** `proj-1` | **Task:** `build-123`
```

**Agent emoji map:**

| Agent | Emoji | Agent | Emoji |
|-------|-------|-------|-------|
| strategist | 🧠 | reviewer | 📋 |
| builder | 🛠️ | scout | 🔍 |
| architect | 📐 | ember | 🔥 |
| designer | 🎨 | forge | ⚒️ |
| deployer | 🚀 | sentinel | 🛡️ |
| treasurer | 💰 | keeper | 🏠 |
| guide | 📚 | (unknown) | 🔔 |

### Safety

- **Rate limit:** Max 1 GitHub comment per 2 seconds (serial queue)
- **Loop prevention:** All comments include `<!-- yclaw-journaler -->` marker,
  checked by both `handleIssueComment` (webhook handler) and `ReactionsManager`
- **Crash-safe:** All GitHub API calls in try/catch — errors logged, never crash

---

## Debugging

### Redis CLI Commands

```bash
# List all coordination streams
redis-cli KEYS 'yclaw:stream:*'

# Stream length
redis-cli XLEN yclaw:stream:coord

# Read last 5 entries
redis-cli XREVRANGE yclaw:stream:coord + - COUNT 5

# Consumer group info
redis-cli XINFO GROUPS yclaw:stream:coord

# Consumer details (lag, pending, idle time)
redis-cli XINFO CONSUMERS yclaw:stream:coord my-group

# Full stream info
redis-cli XINFO STREAM yclaw:stream:coord FULL

# Pending entries (PEL) summary
redis-cli XPENDING yclaw:stream:coord my-group

# Pending entries with details (first 10)
redis-cli XPENDING yclaw:stream:coord my-group - + 10

# Reclaim stuck entry (idle > 5 min)
redis-cli XCLAIM yclaw:stream:coord my-group new-consumer 300000 <entry-id>

# Manual acknowledgment
redis-cli XACK yclaw:stream:coord my-group <entry-id>

# Heartbeat metrics
redis-cli GET heartbeat:metrics:latest
redis-cli GET heartbeat:last_full
```

### Common Failure Modes

| Symptom | Cause | Fix |
|---------|-------|-----|
| Events accumulate, no consumers | No `subscribeStream()` call for the stream | Add consumer registration in main.ts |
| PEL grows continuously | Handler keeps throwing | Fix handler bug, then entries auto-retry on restart |
| Duplicate side effects on restart | Non-idempotent consumer | Make handler idempotent (check-before-act) |
| Stream key missing | No events published yet | `MKSTREAM` in XGROUP CREATE handles this |
| `BUSYGROUP` errors in logs | Consumer group already exists | Expected behavior — logged as info, not error |

---

## Agent Configuration Overrides (Mission Control → Core)

In addition to event-based coordination, agents receive operational overrides from Mission Control via the **SettingsOverlay** (`packages/core/src/config/settings-overlay.ts`).

This is **not** event-driven — it uses direct MongoDB reads with a 5-minute cache:

```
Mission Control → PATCH /api/departments/settings → MongoDB org_settings
                                                          ↓
Core Runtime ← SettingsOverlay.getAgentOverrides() ← 5-min cached read
```

**What flows through:** department directives (injected into system prompt), per-agent model/temperature overrides, cron/event toggle states. YAML trigger-level `modelOverride` always takes precedence.

**What does not flow through:** brand assets, engagement limits, SLA targets, notification preferences (saved to MongoDB but not yet consumed by core).

See [`docs/MISSION-CONTROL.md`](MISSION-CONTROL.md) for the full config bridge architecture.

---

## Migration Notes

The system runs in dual-mode:

1. **Existing pub/sub subscribers** (ReactionsManager, agent routing) are
   unaffected. They continue using `eventBus.subscribe()`.
2. **New coordination consumers** should use `eventStream.subscribeStream()`
   for durability and replay.
3. **Legacy pub/sub** will be deprecated for coordination events in future phases.
   Domain events (`builder:pr_ready`, `architect:pr_review`, etc.) continue
   on pub/sub indefinitely.

---

## SlackNotifier (Coordination Event → Slack Channels)

The SlackNotifier (`src/modules/slack-notifier.ts`) subscribes to `coord.*` events
via Redis Streams consumer group `slack-notifier` and posts Block Kit messages to
department-specific Slack channels.

### Architecture

```
coord.* event published to yclaw:stream:coord
  → Consumer group "slack-notifier" reads via XREADGROUP
    → getChannelForAgent(event.source) → department channel ID
    → buildCoordBlock(event) → Slack Block Kit sections
    → Thread grouping via Redis key slack:thread:{correlation_id} (7-day TTL)
    → SlackExecutor.execute('message' or 'thread_reply')
    → If isEscalation(event): also post to #yclaw-alerts
```

### Channel Routing

| Department | Channel ID | Agents |
|------------|-----------|--------|
| executive | `C0000000001` | strategist, reviewer |
| development | `C0000000002` | architect, builder, deployer, designer |
| marketing | `C0000000003` | ember, forge, scout |
| operations | `C0000000004` | sentinel, signal |
| finance | `C0000000005` | treasurer |
| support | `C0000000006` | guide, keeper |
| alerts | `C0000000007` | escalations |
| (fallback) | `C0000000008` | unknown agents → `#yclaw-general` |

### Event Handling

All `coord.*` events are posted to Slack, except:
- `coord.status.*` — silently skipped (heartbeats, status pings)

### Escalation Events

These event types are posted to **both** the department channel AND `#yclaw-alerts`:
- `coord.task.blocked`
- `coord.task.failed`
- `coord.project.completed`

### Thread Grouping

1. First event for a `correlation_id` → posts as a new message, saves `thread_ts`
   in Redis key `slack:thread:{correlation_id}` with 7-day TTL
2. Subsequent events with the same `correlation_id` → replies in the thread
3. If thread lookup fails → posts as a new message (graceful degradation)

### Message Format (Block Kit)

```
🛠️ *[Builder]* completed task — Implemented feature X
*Implemented feature X*
<https://github.com/yclaw-ai/yclaw/pull/42|View>
─────────────────────────────
Project: `proj-1` | Task: `t-1`
```

### Safety

- **Rate limit:** Max 1 Slack message per second per channel (in-memory queue)
- **Display-only:** SlackNotifier only posts to Slack — it does not consume or
  execute tasks from Slack messages
- **Crash-safe:** All Slack API calls in try/catch — errors logged, never crash
- **Dedup (agent direct path):** `SlackExecutor` fingerprints all `slack:message`
  and `slack:alert` calls via Redis `SET NX` with channel-specific TTLs (30min–2hr).
  Prevents duplicate alerts from agent heartbeat loops. See
  [`AUTONOMOUS-PIPELINE.md`](AUTONOMOUS-PIPELINE.md#slack-alert-dedup-agent-direct-posting).

---

## Source Files

| File | Purpose |
|------|---------|
| [`packages/core/src/types/events.ts`](../packages/core/src/types/events.ts) | YClawEvent<T> envelope, payloads, 14 constants |
| [`packages/core/src/services/event-stream.ts`](../packages/core/src/services/event-stream.ts) | Redis Streams publish/subscribe/PEL replay |
| [`packages/core/src/services/heartbeat-checker.ts`](../packages/core/src/services/heartbeat-checker.ts) | Elvis pattern — lightweight heartbeat pre-check |
| [`packages/core/src/triggers/event.ts`](../packages/core/src/triggers/event.ts) | EventBus with dual-mode + publishCoordEvent() |
| [`packages/core/src/builder/dispatcher.ts`](../packages/core/src/builder/dispatcher.ts) | Builder coord.task.* emitter |
| [`packages/core/src/main.ts`](../packages/core/src/main.ts) | EventStream setup + pub/sub → coord bridges |

| Component | Path |
|-----------|------|
| Event Types | [`packages/core/src/types/events.ts`](../packages/core/src/types/events.ts) |
| EventStream | [`packages/core/src/services/event-stream.ts`](../packages/core/src/services/event-stream.ts) |
| Journaler | [`packages/core/src/modules/journaler.ts`](../packages/core/src/modules/journaler.ts) |
| SlackNotifier | [`packages/core/src/modules/slack-notifier.ts`](../packages/core/src/modules/slack-notifier.ts) |
| Slack Block Kit Helpers | [`packages/core/src/utils/slack-blocks.ts`](../packages/core/src/utils/slack-blocks.ts) |
| Bridge Mappings | [`packages/core/src/main.ts`](../packages/core/src/main.ts) (search "Coordination Event Bridges") |
| EventBus | [`packages/core/src/triggers/event.ts`](../packages/core/src/triggers/event.ts) |
| Journaler Tests | [`packages/core/tests/journaler.test.ts`](../packages/core/tests/journaler.test.ts) |
| SlackNotifier Tests | [`packages/core/tests/slack-notifier.test.ts`](../packages/core/tests/slack-notifier.test.ts) |
| EventStream Tests | [`packages/core/tests/event-stream.test.ts`](../packages/core/tests/event-stream.test.ts) |
