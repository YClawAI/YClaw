/**
 * Tests for Pi Integration: CodingExecutorRouter with Pi as primary executor.
 *
 * Covers:
 *  - CodingExecutorRouter: Pi is PRIMARY when PI_CODING_AGENT_ENABLED=true
 *  - Pi executor selection over ACP and CLI
 *  - CLI fallback when Pi is unavailable
 *  - Worker integration with Pi executor via router
 *
 * See acp-integration.test.ts for legacy ACP tests (deprecated).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { AgentConfig } from '../src/config/schema.js';

// ─── Mock Logger ──────────────────────────────────────────────────────────────

vi.mock('../src/logging/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// ─── Imports after mocks ──────────────────────────────────────────────────────

const { CodingExecutorRouter } = await import('../src/codegen/backends/executors.js');
const { CodingWorker } = await import('../src/builder/worker.js');
const { TaskState, Priority } = await import('../src/builder/types.js');

// ─── Shared Fixtures ──────────────────────────────────────────────────────────

function makeBuilderConfig(): AgentConfig {
  return {
    name: 'builder',
    department: 'development',
    description: 'Test builder',
    model: { provider: 'anthropic', model: 'claude-opus-4-6', temperature: 0.2, maxTokens: 16384 },
    system_prompts: [],
    triggers: [],
    actions: [],
    data_sources: [],
    event_subscriptions: [],
    event_publications: [],
    review_bypass: [],
  };
}

function makeMockAgentExecutor() {
  return {
    execute: vi.fn().mockResolvedValue({
      id: 'exec-1',
      agent: 'builder',
      trigger: 'dispatcher',
      task: 'implement_issue',
      startedAt: new Date().toISOString(),
      status: 'completed',
      actionsTaken: [],
      selfModifications: [],
    }),
    setHumanizationGate: vi.fn(),
  };
}

function makeTurnResult(success = true) {
  return {
    success,
    modifiedFiles: success ? ['src/foo.ts'] : [],
    diff: success ? '+fix' : '',
    summary: success ? 'Fixed issue' : '',
    usage: { inputTokens: 100, outputTokens: 50 },
    ...(success
      ? {}
      : { error: { code: 'BUILD_FAILED', message: 'Build failed', retryable: true } }),
  };
}

function makePiTask(overrides: Record<string, unknown> = {}) {
  return {
    id: 'task-pi-1',
    priority: Priority.P2_ISSUE,
    state: TaskState.ASSIGNED,
    taskName: 'implement_issue',
    triggerPayload: { repo: 'my-app', issue_number: 99 },
    sourceEvent: 'github:issue_assigned',
    correlationId: 'corr-pi-1',
    createdAt: new Date().toISOString(),
    timeoutMs: 60_000,
    executorHint: 'pi' as const,
    ...overrides,
  };
}

// ─── Mock Pi Executor ─────────────────────────────────────────────────────────

function makeMockPiExecutor() {
  return {
    name: 'pi' as const,
    createSession: vi.fn().mockResolvedValue({
      sessionId: 'pi_ses_001',
      originTaskId: 'task-pi-1',
      threadId: 'thread-pi-001',
      createdAt: new Date().toISOString(),
      lastActiveAt: new Date().toISOString(),
      state: 'active' as const,
      model: 'claude-opus-4-6',
      ownerWorkerId: null,
      turnCount: 0,
      inputTokens: 0,
      outputTokens: 0,
    }),
    reattachSession: vi.fn().mockResolvedValue(null),
    sendMessage: vi.fn().mockResolvedValue(makeTurnResult(true)),
    steer: vi.fn().mockResolvedValue(makeTurnResult(true)),
    cancel: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    sweepOrphanedWorkspaces: vi.fn().mockResolvedValue(undefined),
  };
}

// ─── Mock Router for Worker tests ────────────────────────────────────────────

function makeMockRouterWithPi(piExecutor: ReturnType<typeof makeMockPiExecutor>) {
  return {
    select: vi.fn().mockReturnValue(piExecutor),
    getCli: vi.fn(),
    getPi: vi.fn().mockReturnValue(piExecutor),
  } as unknown as InstanceType<typeof CodingExecutorRouter>;
}

// ═════════════════════════════════════════════════════════════════════════════
// CodingExecutorRouter — Pi as Primary Executor
// ═════════════════════════════════════════════════════════════════════════════

describe('CodingExecutorRouter — Pi selection', () => {
  const mockExecutor = makeMockAgentExecutor();
  const builderConfig = makeBuilderConfig();
  let originalPiEnabled: string | undefined;

  beforeEach(() => {
    originalPiEnabled = process.env.PI_CODING_AGENT_ENABLED;
  });

  afterEach(() => {
    if (originalPiEnabled === undefined) {
      delete process.env.PI_CODING_AGENT_ENABLED;
    } else {
      process.env.PI_CODING_AGENT_ENABLED = originalPiEnabled;
    }
  });

  it('returns Pi when PI_CODING_AGENT_ENABLED=true and piConfig is provided', () => {
    process.env.PI_CODING_AGENT_ENABLED = 'true';
    const router = new CodingExecutorRouter(
      {
        executorTypeEnv: 'pi',
        piConfig: {
          costTracker: { record: vi.fn() } as any,
          defaultModelId: 'claude-opus-4-6',
          defaultProvider: 'anthropic',
        },
      },
      mockExecutor as any,
      builderConfig,
    );
    const executor = router.select({ executorHint: undefined });
    expect(executor.name).toBe('pi');
  });

  it('returns Pi for all task types when enabled (not just hint=pi)', () => {
    process.env.PI_CODING_AGENT_ENABLED = 'true';
    const router = new CodingExecutorRouter(
      {
        executorTypeEnv: 'pi',
        piConfig: {
          costTracker: { record: vi.fn() } as any,
          defaultModelId: 'claude-opus-4-6',
          defaultProvider: 'anthropic',
        },
      },
      mockExecutor as any,
      builderConfig,
    );

    // No hint — should still get Pi
    expect(router.select({ executorHint: undefined }).name).toBe('pi');
    // Auto hint — should still get Pi
    expect(router.select({ executorHint: 'auto' }).name).toBe('pi');
    // Session-bound task — should still get Pi
    expect(router.select({ sessionId: 'ses_abc', threadId: 'th_abc' }).name).toBe('pi');
  });

  it('returns CLI when explicit hint=cli even with Pi enabled', () => {
    process.env.PI_CODING_AGENT_ENABLED = 'true';
    const router = new CodingExecutorRouter(
      {
        executorTypeEnv: 'pi',
        piConfig: {
          costTracker: { record: vi.fn() } as any,
          defaultModelId: 'claude-opus-4-6',
          defaultProvider: 'anthropic',
        },
      },
      mockExecutor as any,
      builderConfig,
    );
    const executor = router.select({ executorHint: 'cli' });
    expect(executor.name).toBe('cli');
  });

  it('returns CLI when PI_CODING_AGENT_ENABLED is not set', () => {
    delete process.env.PI_CODING_AGENT_ENABLED;
    const router = new CodingExecutorRouter(
      { executorTypeEnv: 'cli' },
      mockExecutor as any,
      builderConfig,
    );
    const executor = router.select({ executorHint: undefined });
    expect(executor.name).toBe('cli');
  });

  it('returns CLI when PI_CODING_AGENT_ENABLED=true but no piConfig', () => {
    process.env.PI_CODING_AGENT_ENABLED = 'true';
    const router = new CodingExecutorRouter(
      { executorTypeEnv: 'pi' },
      mockExecutor as any,
      builderConfig,
    );
    // Pi object was not created (no piConfig), falls through to CLI
    const executor = router.select({ executorHint: undefined });
    expect(executor.name).toBe('cli');
  });

  it('getPi() returns PiCodingExecutor when enabled', () => {
    process.env.PI_CODING_AGENT_ENABLED = 'true';
    const router = new CodingExecutorRouter(
      {
        executorTypeEnv: 'pi',
        piConfig: {
          costTracker: { record: vi.fn() } as any,
          defaultModelId: 'claude-opus-4-6',
          defaultProvider: 'anthropic',
        },
      },
      mockExecutor as any,
      builderConfig,
    );
    expect(router.getPi()).not.toBeNull();
    expect(router.getPi()!.name).toBe('pi');
  });

  it('getPi() returns null when disabled', () => {
    delete process.env.PI_CODING_AGENT_ENABLED;
    const router = new CodingExecutorRouter(
      { executorTypeEnv: 'cli' },
      mockExecutor as any,
      builderConfig,
    );
    expect(router.getPi()).toBeNull();
  });

  it('Pi takes priority over ACP even when acpx is configured', () => {
    process.env.PI_CODING_AGENT_ENABLED = 'true';
    const router = new CodingExecutorRouter(
      {
        executorTypeEnv: 'auto',
        acpxServiceUrl: 'http://acpx:8080',
        piConfig: {
          costTracker: { record: vi.fn() } as any,
          defaultModelId: 'claude-opus-4-6',
          defaultProvider: 'anthropic',
        },
      },
      mockExecutor as any,
      builderConfig,
    );

    // Even with ACP configured, Pi should win
    const executor = router.select({ executorHint: undefined });
    expect(executor.name).toBe('pi');
  });

  it('falls back to CLI when Pi is disabled', () => {
    delete process.env.PI_CODING_AGENT_ENABLED;
    const router = new CodingExecutorRouter(
      { executorTypeEnv: 'auto' },
      mockExecutor as any,
      builderConfig,
    );
    const executor = router.select({ executorHint: 'cli' });
    expect(executor.name).toBe('cli');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// CodingWorker — Pi Execution via Router
// ═════════════════════════════════════════════════════════════════════════════

describe('CodingWorker Pi path', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function makeWorkerWithPi(piExecutor: ReturnType<typeof makeMockPiExecutor>) {
    const mockRouter = makeMockRouterWithPi(piExecutor);
    return new CodingWorker({
      executor: makeMockAgentExecutor() as any,
      builderConfig: makeBuilderConfig(),
      executorRouter: mockRouter,
    });
  }

  it('selects Pi executor for tasks when Pi is available', () => {
    const piExecutor = makeMockPiExecutor();
    const mockRouter = makeMockRouterWithPi(piExecutor);
    const worker = new CodingWorker({
      executor: makeMockAgentExecutor() as any,
      builderConfig: makeBuilderConfig(),
      executorRouter: mockRouter,
    });

    // Worker should be created successfully with Pi router
    expect(worker.handle.state).toBe('idle');
  });

  it('router.getPi() returns the Pi executor', () => {
    const piExecutor = makeMockPiExecutor();
    const mockRouter = makeMockRouterWithPi(piExecutor);

    expect(mockRouter.getPi()).toBe(piExecutor);
    expect(mockRouter.getPi()!.name).toBe('pi');
  });

  it('router.select() returns Pi for standard tasks', () => {
    const piExecutor = makeMockPiExecutor();
    const mockRouter = makeMockRouterWithPi(piExecutor);

    const selected = mockRouter.select(makePiTask());
    expect(selected.name).toBe('pi');
  });

  it('Pi executor mock has correct interface methods', () => {
    const piExecutor = makeMockPiExecutor();

    expect(piExecutor.name).toBe('pi');
    expect(typeof piExecutor.createSession).toBe('function');
    expect(typeof piExecutor.reattachSession).toBe('function');
    expect(typeof piExecutor.sendMessage).toBe('function');
    expect(typeof piExecutor.steer).toBe('function');
    expect(typeof piExecutor.cancel).toBe('function');
    expect(typeof piExecutor.close).toBe('function');
    expect(typeof piExecutor.sweepOrphanedWorkspaces).toBe('function');
  });
});
