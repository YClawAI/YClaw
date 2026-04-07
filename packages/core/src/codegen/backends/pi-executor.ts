/**
 * PiCodingExecutor — CodingExecutor implementation backed by pi-coding-agent SDK.
 *
 * Replaces brittle CLI process spawning with SDK-mode integration:
 *   - Persistent sessions with conversation history
 *   - Built-in steer() and followUp() for multi-turn work
 *   - Clean abort() for SIGTERM handling
 *   - Custom tools — only YClaw-safe tools, deny-by-default
 *   - Event streaming for cost tracking and observability
 *
 * Architecture decisions (from Phase 0 audit):
 *   - tools: [] + customTools: [...] — disables all built-in tools
 *   - SessionManager.inMemory() — no disk persistence (Fargate constraint)
 *   - PI_CODING_AGENT_DIR=/tmp/pi-agent-config — redirect config writes
 *   - abort() THEN dispose() — correct cleanup sequence
 *   - Event-based cost tracking (no Proxy wrapping)
 */

import { mkdir, rm, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
import {
  createAgentSession,
  SessionManager,
  type AgentSession,
} from '@mariozechner/pi-coding-agent';
import type {
  CodingExecutor,
  SessionHandle,
  TurnResult,
  SteerInput,
  HarnessType,
} from './types.js';
import { PiCostBridge } from '../../llm/pi-cost-bridge.js';
import { createPiModel } from '../../llm/pi-model-factory.js';
import { createYClawTools, type AuditLogFn } from '../tools/index.js';
import type { CostTracker } from '../../costs/cost-tracker.js';
import { createLogger } from '../../logging/logger.js';

const logger = createLogger('pi-executor');

// ─── Config ──────────────────────────────────────────────────────────────────

export interface PiExecutorConfig {
  /** YClaw CostTracker for recording LLM costs. */
  costTracker: CostTracker;
  /** Base directory for task workspaces. Default: /tmp/yclaw-tasks */
  workspaceBaseDir?: string;
  /** Default model ID when not specified per-session. */
  defaultModelId?: string;
  /** Default provider. */
  defaultProvider?: 'anthropic' | 'openrouter' | 'ollama';
}

// ─── Internal State ──────────────────────────────────────────────────────────

interface PiSessionState {
  session: AgentSession;
  sessionId: string;
  costBridge: PiCostBridge;
  workspaceRoot: string;
  /** True if workspace is under workspaceBaseDir and should be cleaned up on close. */
  isOwnedWorkspace: boolean;
  unsubscribers: Array<() => void>;
  createdAt: string;
  turnCount: number;
  model: string;
  taskId: string;
  threadId: string;
}

// ─── Executor ────────────────────────────────────────────────────────────────

export class PiCodingExecutor implements CodingExecutor {
  readonly name = 'pi';
  private readonly sessions = new Map<string, PiSessionState>();
  private readonly config: PiExecutorConfig;
  private readonly workspaceBaseDir: string;

  constructor(config: PiExecutorConfig) {
    this.config = config;
    this.workspaceBaseDir = config.workspaceBaseDir ?? '/tmp/yclaw-tasks';
  }

  // ─── createSession ──────────────────────────────────────────────────────

  async createSession(opts: {
    taskId: string;
    threadId: string;
    harness?: HarnessType;
    model?: string;
    cwd: string;
    timeoutMs?: number;
  }): Promise<SessionHandle> {
    const sessionId = `pi-${opts.taskId}-${Date.now()}`;
    const modelId = opts.model ?? this.config.defaultModelId ?? 'claude-opus-4-6';
    const provider = this.config.defaultProvider ?? 'anthropic';

    // 1. Determine workspace: honor opts.cwd from the worker (repo checkout path).
    //    Fall back to /tmp/yclaw-tasks/<taskId> only for scratch tasks without a repo.
    const workspaceRoot = opts.cwd && opts.cwd !== '/workspaces'
      ? opts.cwd
      : join(this.workspaceBaseDir, opts.taskId);
    const isOwnedWorkspace = workspaceRoot.startsWith(this.workspaceBaseDir);
    await mkdir(workspaceRoot, { recursive: true });

    // 2. Create cost bridge (event-based)
    const costBridge = new PiCostBridge(this.config.costTracker, {
      agentName: 'builder',
      taskId: opts.taskId,
      modelId,
      provider,
    });

    // 3. Create YClaw-safe tools
    const auditLogger: AuditLogFn = (toolName, target, outcome) => {
      logger.info('Tool execution', { toolName, target, outcome, taskId: opts.taskId });
    };
    const tools = createYClawTools({ workspaceRoot, auditLogger });

    // 4. Create pi model
    const model = createPiModel(provider, modelId);

    // 5. Create pi session — CORRECT API from Phase 0 audit
    const { session } = await createAgentSession({
      tools: [],               // DISABLE all built-in tools
      customTools: tools,      // Our YClaw-safe tools only
      cwd: workspaceRoot,
      model,
      sessionManager: SessionManager.inMemory(),
    });

    // 6. Wire cost tracking via event subscription
    const unsubscribeCost = session.subscribe((event: unknown) => {
      costBridge.handleEvent(event);
    });

    // 7. Wire observability events
    const unsubscribeObs = session.subscribe((event: unknown) => {
      this.handleObservabilityEvent(event, opts.taskId);
    });

    // 8. Store session state
    const now = new Date().toISOString();
    const state: PiSessionState = {
      session,
      sessionId,
      costBridge,
      workspaceRoot,
      isOwnedWorkspace,
      unsubscribers: [unsubscribeCost, unsubscribeObs],
      createdAt: now,
      turnCount: 0,
      model: modelId,
      taskId: opts.taskId,
      threadId: opts.threadId,
    };
    this.sessions.set(sessionId, state);

    logger.info('Pi session created', {
      sessionId,
      taskId: opts.taskId,
      threadId: opts.threadId,
      model: modelId,
      workspace: workspaceRoot,
    });

    // 9. Return SessionHandle
    return {
      sessionId,
      acpResourceUri: `pi://local/${sessionId}`,
      originTaskId: opts.taskId,
      threadId: opts.threadId,
      createdAt: now,
      lastActiveAt: now,
      state: 'active',
      model: modelId,
      harness: 'pi',
      ownerWorkerId: null,
      turnCount: 0,
      inputTokens: 0,
      outputTokens: 0,
    };
  }

  // ─── reattachSession ────────────────────────────────────────────────────

  async reattachSession(sessionId: string): Promise<SessionHandle | null> {
    // Pi sessions are in-memory only — cannot reattach after worker death.
    // This is expected: SessionManager.inMemory() means sessions don't survive restarts.
    const state = this.sessions.get(sessionId);
    if (!state) return null;

    const totals = state.costBridge.getTotals();
    return {
      sessionId,
      acpResourceUri: `pi://local/${sessionId}`,
      originTaskId: state.taskId,
      threadId: state.threadId,
      createdAt: state.createdAt,
      lastActiveAt: new Date().toISOString(),
      state: 'active',
      model: state.model,
      harness: 'pi',
      ownerWorkerId: null,
      turnCount: state.turnCount,
      inputTokens: totals.inputTokens,
      outputTokens: totals.outputTokens,
    };
  }

  // ─── sendMessage ────────────────────────────────────────────────────────

  async sendMessage(
    sessionId: string,
    prompt: string,
    opts?: { timeoutMs?: number; model?: string },
  ): Promise<TurnResult> {
    const state = this.sessions.get(sessionId);
    if (!state) {
      throw new Error(`Pi session not found: ${sessionId}`);
    }

    const startTime = Date.now();
    const timeoutMs = opts?.timeoutMs ?? 720_000; // 12 min default
    let timedOut = false;

    // Timeout: abort the pi session directly — this causes prompt() to reject.
    // No AbortController needed; session.abort() is the abort mechanism.
    const timeoutId = setTimeout(() => {
      timedOut = true;
      logger.warn('Pi session timed out, aborting', { sessionId, timeoutMs });
      state.session.abort().catch((err: unknown) => {
        logger.error('Abort failed during timeout', {
          sessionId,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }, timeoutMs);

    try {
      // session.prompt() runs the full agent loop
      await state.session.prompt(prompt);
      state.turnCount++;

      // Collect results
      const modifiedFiles = await this.getModifiedFiles(state.workspaceRoot);
      const diff = await this.getGitDiff(state.workspaceRoot);
      const totals = state.costBridge.getTotals();

      logger.info('Pi session turn completed', {
        sessionId,
        taskId: state.taskId,
        turnCount: state.turnCount,
        modifiedFiles: modifiedFiles.length,
        durationMs: Date.now() - startTime,
      });

      return {
        success: true,
        modifiedFiles,
        diff,
        summary: `Completed turn ${state.turnCount}`,
        usage: {
          inputTokens: totals.inputTokens,
          outputTokens: totals.outputTokens,
        },
      };
    } catch (error: unknown) {
      const err = error instanceof Error ? error : new Error(String(error));
      const isTimeout = timedOut;

      logger.error(`Pi session turn ${isTimeout ? 'timed out' : 'failed'}`, {
        sessionId,
        taskId: state.taskId,
        error: err.message,
      });

      const totals = state.costBridge.getTotals();
      return {
        success: false,
        modifiedFiles: [],
        diff: '',
        summary: err.message,
        usage: {
          inputTokens: totals.inputTokens,
          outputTokens: totals.outputTokens,
        },
        error: {
          code: isTimeout ? 'TIMEOUT' : 'EXECUTION_ERROR',
          message: err.message,
          retryable: isTimeout,
        },
      };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  // ─── steer ──────────────────────────────────────────────────────────────

  async steer(sessionId: string, input: SteerInput): Promise<TurnResult> {
    const state = this.sessions.get(sessionId);
    if (!state) {
      throw new Error(`Pi session not found: ${sessionId}`);
    }

    // Pi's steer() is synchronous — queues message for next turn
    // It does NOT run a prompt; it injects the message into the steering queue
    state.session.steer(input.instruction);

    // Return current state (steer doesn't produce immediate results)
    const totals = state.costBridge.getTotals();
    return {
      success: true,
      modifiedFiles: [],
      diff: '',
      summary: `Steered: ${input.instruction.slice(0, 100)}`,
      usage: {
        inputTokens: totals.inputTokens,
        outputTokens: totals.outputTokens,
      },
    };
  }

  // ─── cancel ─────────────────────────────────────────────────────────────

  async cancel(sessionId: string): Promise<void> {
    const state = this.sessions.get(sessionId);
    if (!state) return;

    // CORRECT sequence from audit: abort() awaits completion via waitForIdle()
    try {
      await state.session.abort();
    } catch (err) {
      logger.warn('Pi session abort error (non-fatal)', {
        sessionId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    // Don't dispose yet — close() handles full cleanup
  }

  // ─── close ──────────────────────────────────────────────────────────────

  async close(sessionId: string): Promise<void> {
    const state = this.sessions.get(sessionId);
    if (!state) return;

    try {
      // Abort if still running
      await state.session.abort().catch(() => {});

      // Disconnect event listeners
      for (const unsub of state.unsubscribers) unsub();
      state.session.dispose();

      logger.info('Pi session closed', {
        sessionId,
        taskId: state.taskId,
        turnCount: state.turnCount,
      });
    } finally {
      // Only clean up workspaces we created (under workspaceBaseDir).
      // Repo checkouts passed via opts.cwd are managed by the provisioner.
      if (state.isOwnedWorkspace) {
        await rm(state.workspaceRoot, { recursive: true, force: true }).catch((err) => {
          logger.warn('Workspace cleanup failed (non-fatal)', {
            sessionId,
            workspace: state.workspaceRoot,
          error: err instanceof Error ? err.message : String(err),
        });
        });
      }
      this.sessions.delete(sessionId);
    }
  }

  // ─── Workspace Management ──────────────────────────────────────────────

  /**
   * Sweep orphaned workspaces on startup.
   * Removes any task directories that don't have an active session.
   */
  async sweepOrphanedWorkspaces(): Promise<void> {
    let entries: string[];
    try {
      entries = await readdir(this.workspaceBaseDir);
    } catch {
      // Directory doesn't exist yet — nothing to sweep
      return;
    }

    const activeTaskIds = new Set(
      [...this.sessions.values()].map((s) => s.taskId),
    );

    for (const entry of entries) {
      if (!activeTaskIds.has(entry)) {
        const entryPath = join(this.workspaceBaseDir, entry);
        await rm(entryPath, { recursive: true, force: true }).catch(() => {});
        logger.info('Cleaned orphaned workspace', { taskId: entry, path: entryPath });
      }
    }
  }

  /** Returns the number of active sessions (for monitoring). */
  get activeSessionCount(): number {
    return this.sessions.size;
  }

  // ─── Observability ─────────────────────────────────────────────────────

  private handleObservabilityEvent(event: unknown, taskId: string): void {
    if (!event || typeof event !== 'object' || !('type' in event)) return;
    const evt = event as { type: string; [key: string]: unknown };

    switch (evt.type) {
      case 'tool_execution_start':
        logger.debug('Pi tool start', {
          tool: (evt as { toolName?: string }).toolName,
          taskId,
        });
        break;
      case 'tool_execution_end':
        logger.debug('Pi tool end', {
          tool: (evt as { toolName?: string }).toolName,
          taskId,
          isError: (evt as { isError?: boolean }).isError,
        });
        break;
      case 'agent_end':
        logger.info('Pi agent turn ended', { taskId });
        break;
    }
  }

  // ─── Helpers ───────────────────────────────────────────────────────────

  private async getModifiedFiles(cwd: string): Promise<string[]> {
    try {
      const { stdout } = await execFileAsync('git', ['diff', '--name-only', 'HEAD'], {
        cwd,
        timeout: 5_000,
        maxBuffer: 1024 * 1024,
      });
      return stdout.split('\n').map((l) => l.trim()).filter(Boolean);
    } catch {
      // Fallback: untracked + modified files (no git history)
      try {
        const { stdout } = await execFileAsync(
          'git', ['ls-files', '--modified', '--others', '--exclude-standard'],
          { cwd, timeout: 5_000, maxBuffer: 1024 * 1024 },
        );
        return stdout.split('\n').map((l) => l.trim()).filter(Boolean);
      } catch {
        return [];
      }
    }
  }

  private async getGitDiff(cwd: string): Promise<string> {
    try {
      const { stdout } = await execFileAsync('git', ['diff', 'HEAD'], {
        cwd,
        timeout: 10_000,
        maxBuffer: 1024 * 1024,
      });
      return stdout;
    } catch {
      return '';
    }
  }
}
