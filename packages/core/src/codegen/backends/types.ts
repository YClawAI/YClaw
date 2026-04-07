import type { BackendExecuteParams, BackendResult } from '../types.js';

// ─── Codegen Backend Interface (legacy) ─────────────────────────────────────
//
// Each CLI coding tool implements this interface.
// Backends are selected by repo config preference or fallback chain.
//

export interface CodegenBackend {
  readonly name: string;
  execute(params: BackendExecuteParams): Promise<BackendResult>;
  isAvailable(): Promise<boolean>;
}

// ─── Session Types (ACP) ────────────────────────────────────────────────────

export type SessionId = string;

export type SessionState =
  | 'creating'
  | 'active'
  | 'detached'    // Worker released; session still alive on acpx
  | 'completed'
  | 'failed'
  | 'expired';

export type HarnessType = 'claude-code' | 'codex' | 'opencode' | 'gemini-cli' | 'pi';

export interface SessionHandle {
  sessionId: SessionId;
  /** ACP resource URI on the acpx service (empty for CLI sessions). */
  acpResourceUri: string;
  originTaskId: string;
  threadId: string;
  createdAt: string;          // ISO-8601
  lastActiveAt: string;       // ISO-8601
  state: SessionState;
  model: string;
  harness: HarnessType;
  ownerWorkerId: string | null;
  turnCount: number;
  inputTokens: number;
  outputTokens: number;
}

// ─── Turn I/O ────────────────────────────────────────────────────────────────

export interface SteerInput {
  instruction: string;
  context?: Record<string, unknown>;
  focusFiles?: string[];
  timeoutMs?: number;
}

export interface TurnResult {
  success: boolean;
  modifiedFiles: string[];
  diff: string;
  summary: string;
  usage: { inputTokens: number; outputTokens: number };
  error?: { code: string; message: string; retryable: boolean };
}

// ─── Executor Interface ──────────────────────────────────────────────────────

export interface CodingExecutor {
  readonly name: string;

  createSession(opts: {
    taskId: string;
    threadId: string;
    harness?: HarnessType;
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

// ─── Executor Hint ──────────────────────────────────────────────────────────

/** Type-safe executor selection hint. Used by the router to pick the right backend. */
export type ExecutorHint = 'cli' | 'pi' | 'auto';

// ─── Executor Capabilities ───────────────────────────────────────────────────

export interface ExecutorCapabilities {
  supportsSessions: boolean;
  supportsReattach: boolean;
  supportsStreamingLogs: boolean;
  supportsWorkspacePersistence: boolean;
}
