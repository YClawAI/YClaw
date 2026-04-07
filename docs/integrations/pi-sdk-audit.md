# Pi-Coding-Agent SDK Audit (Phase 0)

**Date:** 2026-03-24
**Status:** GO (with corrections to meta prompt API assumptions)
**SDK Source:** `github.com/badlogic/pi-mono` (commit at time of audit)

---

## 0A. SDK Feasibility Test

### API Surface Correction

**CRITICAL:** The meta prompt assumes `createAgentSession({ tools: [...] })` replaces defaults with custom tools. **This is incorrect.** The actual API works differently:

```typescript
// sdk.ts (lines 42-73) — CreateAgentSessionOptions
{
  tools?: Tool[],            // FILTERS built-in tools (read, bash, edit, write, grep, find, ls)
  customTools?: ToolDefinition[],  // ADDITIONAL custom tools (separate parameter)
  // ...other options
}
```

**How `tools` actually works** (sdk.ts lines 242-245):

```typescript
const initialActiveToolNames: ToolName[] = options.tools
  ? options.tools.map((t) => t.name).filter((n): n is ToolName => n in allTools)
  : defaultActiveToolNames;  // default: ["read", "bash", "edit", "write"]
```

When `tools` is provided, it extracts tool **names** and keeps only those matching built-in tool names. Non-matching names are **silently dropped**. Custom tools must go via `customTools`.

### Correct Configuration for YClaw

```typescript
const { session } = await createAgentSession({
  tools: [],                          // DISABLE all built-in tools
  customTools: [                      // Our YClaw-safe tools
    yclawReadTool,
    yclawWriteTool,
    yclawEditTool,
    yclawBashTool,
  ],
  cwd: `/tmp/yclaw-tasks/${taskId}`,
  model: getModel("anthropic", "claude-sonnet-4-20250514"),
  sessionManager: SessionManager.inMemory(),  // No disk persistence
});
```

### Tool Override Verification

- Passing `tools: []` sets `initialActiveToolNames` to `[]` — **all built-in tools disabled**.
- `customTools` are registered separately and are always available.
- **Deny-by-default is achievable.** New built-in tools added in future pi versions will NOT activate because we pass an explicit empty `tools` array.
- **Verification test:** Create session with `tools: [], customTools: [readOnlyTool]`. Ask agent to write a file. Expected: agent reports no write capability. If it writes → defaults leaked → **STOP**.

### ToolDefinition Interface

```typescript
// packages/coding-agent/src/core/extensions/types.ts:364-397
interface ToolDefinition<TParams extends TSchema = TSchema, TDetails = unknown> {
  name: string;
  label: string;
  description: string;
  promptSnippet?: string;
  promptGuidelines?: string[];
  parameters: TParams;                    // TypeBox schema

  execute(
    toolCallId: string,
    params: Static<TParams>,
    signal: AbortSignal | undefined,
    onUpdate: AgentToolUpdateCallback<TDetails> | undefined,
    ctx: ExtensionContext,
  ): Promise<AgentToolResult<TDetails>>;

  renderCall?: (...) => Component;        // Optional UI rendering
  renderResult?: (...) => Component;      // Optional UI rendering
}

// Return type
interface AgentToolResult<T> {
  content: (TextContent | ImageContent)[];
  details: T;
}
```

### Session Lifecycle

| Method | Behavior | Blocks? |
|--------|----------|---------|
| `session.prompt(text)` | Runs agent loop, throws if already running | Yes (async) |
| `session.steer(msg)` | Queues message for next turn | No (sync) |
| `session.followUp(msg)` | Queues for after current prompt completes | No (sync) |
| `session.abort()` | Calls agent.abort() + waitForIdle() | Yes (async) |
| `session.dispose()` | Disconnects listeners, clears event handlers | No (sync) |

**Abort timing:** `session.abort()` (AgentSession level) awaits completion via `waitForIdle()`. The underlying `agent.abort()` fires AbortSignal immediately but doesn't wait. For SIGTERM handling, `session.abort()` is the right call — it resolves when the agent actually stops.

### Event System

**Events emitted via `session.subscribe()`:**

| Event | When |
|-------|------|
| `agent_start` | Prompt processing begins |
| `agent_end` | All processing complete (includes final messages) |
| `turn_start` | New LLM turn begins |
| `turn_end` | LLM turn complete (includes tool results) |
| `message_start` | Assistant message begins streaming |
| `message_update` | Token-by-token streaming update |
| `message_end` | Assistant message complete |
| `tool_execution_start` | Tool call begins (includes toolName, args) |
| `tool_execution_update` | Tool progress update |
| `tool_execution_end` | Tool call complete (includes result, isError) |
| `auto_compaction_start` | Context window compaction triggered |
| `auto_compaction_end` | Compaction complete |
| `auto_retry_start` | Automatic retry on transient error |
| `auto_retry_end` | Retry resolved |

### Token/Cost Tracking via Events

Each `AssistantMessage` (available in `message_end` and `turn_end` events) contains:

```typescript
usage: {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
  cost: {
    input: number;      // USD
    output: number;     // USD
    cacheRead: number;  // USD
    cacheWrite: number; // USD
    total: number;      // USD
  };
}
```

**Recommendation:** Subscribe to `message_end` events and accumulate usage. No need for a Proxy wrapper around the model — pi-ai computes costs natively using `calculateCost()` (packages/ai/src/models.ts:39-46). Feed accumulated usage into YClaw's `costTracker.record()` after each turn.

### No TTY Required

SDK mode does not require TTY. Interactive mode checks `process.stdin.isTTY` only in the CLI entry point (main.ts), not in the SDK path.

### dispose() Cleanup

`dispose()` only disconnects event listeners and unsubscribes from the agent. It does **NOT**:
- Abort running operations (call `abort()` first)
- Clean up filesystem (caller's responsibility)
- Close network connections (model API connections are per-request)

Correct cleanup sequence:
```typescript
await session.abort();   // Stop any running work
session.dispose();       // Disconnect listeners
// Then clean up workspace directory
```

---

## 0B. Fargate Constraint Mapping

| Constraint | Status | Notes |
|---|---|---|
| Read-only rootfs | **CAUTION** | SDK writes to `~/.pi/agent/` by default (auth.json, settings.json, sessions/). **Fix:** Set `PI_CODING_AGENT_DIR=/tmp/pi-agent-config` env var to redirect. Use `SessionManager.inMemory()` to avoid session file writes entirely. |
| `/tmp` only writes | **OK with config** | Set `cwd` to `/tmp/yclaw-tasks/${taskId}/`. Set `PI_CODING_AGENT_DIR=/tmp/pi-agent-config`. No other writes expected. |
| No TTY | **OK** | SDK mode has no TTY dependency. |
| No Docker socket | **OK** | Our custom bash tool will block Docker commands via safety gate. Pi's built-in bash is disabled (`tools: []`). |
| SIGTERM handling | **OK** | `session.abort()` fires AbortSignal and awaits `waitForIdle()`. Should complete within seconds (current tool call finishes, no new turns started). Budget 5s for abort + 2s for cleanup = 7s well within 30s SIGTERM window. |
| Memory footprint | **MONITOR** | Per-session: Agent instance + conversation history in memory. With `SessionManager.inMemory()`, all state is heap-resident. Estimate ~50-100MB per active session with moderate conversation history. 3 workers = ~300MB baseline. |
| Concurrent sessions | **OK with caveats** | Module-level registries (modelRegistry, apiProviderRegistry) are shared but read-only after init. **NEVER call `clearApiProviders()`** — it's global and would kill all sessions. Each Agent instance has fully isolated state (listeners, abort controller, tool execution). |

### Filesystem Writes Summary

**Default SDK writes (must be redirected):**
```
~/.pi/agent/auth.json          → Redirect via PI_CODING_AGENT_DIR
~/.pi/agent/settings.json      → Redirect via PI_CODING_AGENT_DIR
~/.pi/agent/models.json        → Redirect via PI_CODING_AGENT_DIR
~/.pi/agent/sessions/          → Eliminated via SessionManager.inMemory()
~/.pi/agent/<app>-debug.log    → Redirect via PI_CODING_AGENT_DIR
```

**Our writes (all under /tmp):**
```
/tmp/yclaw-tasks/${taskId}/     → Workspace per task (cleaned up in worker finally block)
/tmp/pi-agent-config/          → Shared config dir (created once at startup)
```

### Environment Variables for Fargate

```bash
PI_CODING_AGENT_DIR=/tmp/pi-agent-config   # Redirect all config writes to /tmp
# No PI_PACKAGE_DIR needed (we don't use pi's built-in resources)
```

---

## 0C. Tool Override Verification

### Mechanism

1. `tools: []` → `initialActiveToolNames = []` → no built-in tools registered
2. `customTools: [...]` → our tools registered via separate path
3. Future pi versions adding new built-in tools (e.g., `grep`, `find`) → NOT activated because we explicitly pass `tools: []`

### Verification Protocol

```typescript
// Test 1: Deny-by-default
const { session } = await createAgentSession({
  tools: [],
  customTools: [yclawReadTool],  // Only read
  cwd,
  model: getModel("anthropic", "claude-sonnet-4-20250514"),
  sessionManager: SessionManager.inMemory(),
});

await session.prompt("Create a file called evil.txt with content 'pwned'");
// PASS: Agent says it cannot write files
// FAIL: File exists → built-in tools leaked → HARD STOP

// Test 2: Custom tools work
await session.prompt("Read test.txt");
// PASS: Agent uses our yclawReadTool successfully
// FAIL: Agent says it has no tools → customTools not registered

// Test 3: Built-in tools fully disabled
await session.prompt("Run 'echo hello' in bash");
// PASS: Agent says it cannot run commands
// FAIL: Command executes → bash tool leaked → HARD STOP
```

### Risk: `customTools` vs `tools` Naming

The meta prompt uses `tools` for custom tool injection. The SDK uses `customTools`. **All phase prompts must be corrected** to use:
- `tools: []` (disable built-ins)
- `customTools: [...]` (inject YClaw-safe tools)

---

## 0D. Existing Backend Interface Audit

### CodingExecutor Interface

```typescript
// packages/core/src/codegen/backends/types.ts:64-91
interface CodingExecutor {
  readonly name: string;

  createSession(opts: {
    taskId: string;
    threadId: string;
    harness?: HarnessType;      // 'claude-code' | 'codex' | 'opencode' | 'gemini-cli' | 'pi'
    model?: string;
    cwd: string;
    timeoutMs?: number;
  }): Promise<SessionHandle>;

  reattachSession(sessionId: string): Promise<SessionHandle | null>;

  sendMessage(
    sessionId: string,
    prompt: string,
    opts?: { timeoutMs?: number; model?: string },
  ): Promise<TurnResult>;

  steer(sessionId: string, input: SteerInput): Promise<TurnResult>;

  cancel(sessionId: string): Promise<void>;

  close(sessionId: string): Promise<void>;
}
```

### Key Types

```typescript
type HarnessType = 'claude-code' | 'codex' | 'opencode' | 'gemini-cli' | 'pi';

interface SessionHandle {
  sessionId: SessionId;
  acpResourceUri: string;
  originTaskId: string;
  threadId: string;
  createdAt: string;            // ISO-8601
  lastActiveAt: string;
  state: SessionState;          // 'creating' | 'active' | 'detached' | 'completed' | 'failed' | 'expired'
  model: string;
  harness: HarnessType;
  ownerWorkerId: string | null;
  turnCount: number;
  inputTokens: number;
  outputTokens: number;
}

interface TurnResult {
  success: boolean;
  modifiedFiles: string[];
  diff: string;
  summary: string;
  usage: { inputTokens: number; outputTokens: number };
  error?: { code: string; message: string; retryable: boolean };
}

interface SteerInput {
  instruction: string;
  context?: Record<string, unknown>;
  focusFiles?: string[];
  timeoutMs?: number;
}
```

### Existing Backends

| Backend | File | Capabilities |
|---------|------|-------------|
| **Spawn CLI Executor** | `spawn-cli-executor.ts` | CLI wrapper. No persistence, no steering (`steer()` throws), `reattachSession()` always returns null. |

### CodingExecutorRouter

```typescript
// packages/core/src/codegen/backends/executors.ts
// Selection order:
// 1. task.executorHint === 'pi' + PI_CODING_AGENT_ENABLED → Pi
// 2. task.executorHint === 'cli' → CLI
// 3. Fallback: CLI
```

**Environment variables:** `EXECUTOR_TYPE` ('cli' default | 'pi'), `PI_CODING_AGENT_ENABLED`

### Worker Execution Flow

```
Task dequeued → Worker.execute()
  ├── CLI path: AgentExecutor.execute() with abort signal + timeout
  └── Pi path:  PiCodingExecutor session with YClaw-safe custom tools

Worker expects back: TurnResult { success, modifiedFiles, diff, summary, usage, error? }
```

### Cost Tracking Interface

```typescript
// packages/core/src/costs/cost-tracker.ts
costTracker.record({
  agentId: string;
  department: string;
  taskType: string;
  executionId: string;
  modelId: string;
  provider: 'anthropic' | 'openrouter' | 'ollama';
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  latencyMs: number;
});
```

Redis hot path (daily/monthly counters) + MongoDB cold path (full events).

### Feature Flags

Gating is via:
- `EXECUTOR_TYPE` env var (defaults to 'cli')
- `PI_CODING_AGENT_ENABLED` env var (defaults to 'false')
- `task.executorHint` per-task override

---

## 0E. Go/No-Go Decision

### GO — with the following corrections and conditions:

#### Corrections to Meta Prompt

1. **Tool injection API:** Use `tools: []` + `customTools: [...]`, NOT `tools: [...]`
2. **`steer()` and `followUp()` are synchronous** (queue-based), not async. They don't return Promises at the Agent level. `AgentSession.steer()` may differ — verify at implementation time.
3. **`dispose()` does NOT abort** — must call `abort()` first.
4. **Filesystem redirects required** — set `PI_CODING_AGENT_DIR=/tmp/pi-agent-config`.

#### Exact `createAgentSession()` Config for YClaw

```typescript
import { createAgentSession, SessionManager } from "@mariozechner/pi-coding-agent";
import { getModel } from "@mariozechner/pi-ai";

const workspaceDir = `/tmp/yclaw-tasks/${taskId}`;

const { session } = await createAgentSession({
  // Disable ALL built-in tools
  tools: [],

  // Inject YClaw-safe custom tools
  customTools: [yclawReadTool, yclawWriteTool, yclawEditTool, yclawBashTool],

  // Workspace isolation
  cwd: workspaceDir,

  // Model
  model: getModel("anthropic", "claude-sonnet-4-20250514"),

  // No disk persistence (all state in memory)
  sessionManager: SessionManager.inMemory(),
});
```

**Required env vars:**
```bash
PI_CODING_AGENT_DIR=/tmp/pi-agent-config
PI_CODING_AGENT_ENABLED=false   # Feature flag — off by default
```

#### Memory/Storage Budget per Worker

| Resource | Budget | Notes |
|----------|--------|-------|
| Heap memory | ~100MB | Agent + conversation history (in-memory sessions) |
| `/tmp` disk | ~2GB | Workspace files + cloned repos |
| `/tmp/pi-agent-config` | <1MB | Shared config dir (auth, settings) |
| Total per 3 workers | ~300MB heap, ~6GB disk | Well within Fargate limits |

#### Tools to Implement (Phase 1B)

| Tool | Purpose | Safety Gate |
|------|---------|------------|
| `yclaw-read` | Read files within workspace | Workspace boundary check |
| `yclaw-write` | Write files within workspace | Workspace boundary + hard gate validation |
| `yclaw-edit` | Edit files within workspace | Workspace boundary + hard gate validation |
| `yclaw-bash` | Execute shell commands | Command allowlist + no Docker + hard gate |
| `yclaw-grep` | Search file contents | Workspace boundary (read-only, low risk) |
| `yclaw-ls` | List directory contents | Workspace boundary (read-only, low risk) |

#### Risks and Mitigations

| Risk | Severity | Mitigation |
|------|----------|------------|
| `clearApiProviders()` called by one session kills all | High | Never call it. Wrap in safety check or patch upstream. |
| Auth file race condition (3 workers, 1 file) | Medium | Pass `authStorage` programmatically per session; don't rely on file-based auth. |
| Memory growth from long conversations | Medium | Monitor heap per session. Set max turn count. Use compaction events to track. |
| `customTools` parameter silently ignored in future SDK version | Low | Pin SDK version (`--save-exact`). Add integration test verifying tool isolation on every upgrade. |

---

## Appendix: Pi SDK Package Structure

```
pi-mono/
├── packages/
│   ├── agent/           # Core Agent class, event types, agent loop
│   ├── ai/              # Model registry, getModel(), cost calculation
│   ├── coding-agent/    # createAgentSession(), tools, session manager
│   └── ...
```

**Key files:**
- `packages/coding-agent/src/core/sdk.ts` — `createAgentSession()` implementation
- `packages/coding-agent/src/core/tools/index.ts` — Built-in tool registry
- `packages/coding-agent/src/core/extensions/types.ts` — `ToolDefinition` interface
- `packages/coding-agent/src/core/agent-session.ts` — `AgentSession` class
- `packages/agent/src/agent.ts` — Core `Agent` class
- `packages/agent/src/types.ts` — Event types, `AgentTool` interface
- `packages/ai/src/models.ts` — `getModel()`, `calculateCost()`
- `packages/coding-agent/src/config.ts` — Default paths (`~/.pi/agent/`)
