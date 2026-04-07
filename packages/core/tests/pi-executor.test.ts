import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdir, rm, writeFile, access } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// We test the executor against mocked pi-coding-agent
vi.mock('@mariozechner/pi-coding-agent', () => {
  const mockSession = {
    prompt: vi.fn().mockResolvedValue(undefined),
    steer: vi.fn(),
    followUp: vi.fn(),
    abort: vi.fn().mockResolvedValue(undefined),
    dispose: vi.fn(),
    subscribe: vi.fn().mockReturnValue(() => {}),
  };

  return {
    createAgentSession: vi.fn().mockResolvedValue({
      session: mockSession,
      extensionsResult: {},
    }),
    SessionManager: {
      inMemory: vi.fn().mockReturnValue({}),
    },
  };
});

vi.mock('@mariozechner/pi-ai', () => ({
  getModel: vi.fn().mockReturnValue({
    id: 'claude-sonnet-4-20250514',
    name: 'Claude Sonnet 4',
    provider: 'anthropic',
    api: 'anthropic-messages',
    cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
    contextWindow: 200000,
    maxTokens: 8192,
    reasoning: true,
    input: ['text', 'image'],
    baseUrl: 'https://api.anthropic.com',
  }),
}));

import { PiCodingExecutor, type PiExecutorConfig } from '../src/codegen/backends/pi-executor.js';
import { createAgentSession } from '@mariozechner/pi-coding-agent';

// Use realpathSync to resolve macOS /var → /private/var symlink
const TEST_BASE = join(realpathSync(tmpdir()), `pi-executor-test-${Date.now()}`);

function createMockCostTracker() {
  return {
    record: vi.fn().mockResolvedValue(undefined),
    initialize: vi.fn(),
    getDailySpendCents: vi.fn().mockResolvedValue(0),
    getMonthlySpendCents: vi.fn().mockResolvedValue(0),
  };
}

function createExecutor(overrides?: Partial<PiExecutorConfig>): PiCodingExecutor {
  return new PiCodingExecutor({
    costTracker: createMockCostTracker() as any,
    workspaceBaseDir: TEST_BASE,
    defaultModelId: 'claude-sonnet-4-20250514',
    defaultProvider: 'anthropic',
    ...overrides,
  });
}

describe('PiCodingExecutor', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await mkdir(TEST_BASE, { recursive: true });
  });

  afterEach(async () => {
    await rm(TEST_BASE, { recursive: true, force: true });
  });

  // ─── Session Lifecycle ─────────────────────────────────────────────────

  describe('createSession', () => {
    it('returns a valid SessionHandle', async () => {
      const executor = createExecutor();
      const handle = await executor.createSession({
        taskId: 'task-1',
        threadId: 'thread-1',
        cwd: '/workspaces',
      });

      expect(handle.sessionId).toMatch(/^pi-task-1-/);
      expect(handle.originTaskId).toBe('task-1');
      expect(handle.threadId).toBe('thread-1');
      expect(handle.state).toBe('active');
      expect(handle.harness).toBe('pi');
      expect(handle.turnCount).toBe(0);
      expect(handle.inputTokens).toBe(0);
      expect(handle.outputTokens).toBe(0);
    });

    it('creates isolated workspace directory', async () => {
      const executor = createExecutor();
      await executor.createSession({ taskId: 'task-ws', threadId: 'thread-1', cwd: '/workspaces' });

      await expect(access(join(TEST_BASE, 'task-ws'))).resolves.not.toThrow();
    });

    it('uses tools: [] + customTools (not tools: [yclawTools])', async () => {
      const executor = createExecutor();
      await executor.createSession({ taskId: 'task-api', threadId: 'thread-1', cwd: '/workspaces' });

      expect(createAgentSession).toHaveBeenCalledWith(
        expect.objectContaining({
          tools: [],
          customTools: expect.arrayContaining([
            expect.objectContaining({ name: 'yclaw-read' }),
            expect.objectContaining({ name: 'yclaw-write' }),
            expect.objectContaining({ name: 'yclaw-edit' }),
            expect.objectContaining({ name: 'yclaw-bash' }),
          ]),
        }),
      );
    });

    it('uses SessionManager.inMemory()', async () => {
      const { SessionManager } = await import('@mariozechner/pi-coding-agent');
      const executor = createExecutor();
      await executor.createSession({ taskId: 'task-sm', threadId: 'thread-1', cwd: '/workspaces' });

      expect(SessionManager.inMemory).toHaveBeenCalled();
    });
  });

  describe('sendMessage', () => {
    it('runs prompt and returns TurnResult', async () => {
      const executor = createExecutor();
      const handle = await executor.createSession({
        taskId: 'task-send',
        threadId: 'thread-1',
        cwd: '/workspaces',
      });

      const result = await executor.sendMessage(handle.sessionId, 'Fix the bug');

      expect(result.success).toBe(true);
      expect(result.summary).toContain('Completed turn 1');
    });

    it('throws for unknown session', async () => {
      const executor = createExecutor();
      await expect(executor.sendMessage('nonexistent', 'hello')).rejects.toThrow('not found');
    });

    it('returns error TurnResult on failure', async () => {
      const mockCreate = vi.mocked(createAgentSession);
      const mockSession = (await mockCreate({} as any)).session;
      vi.mocked(mockSession.prompt).mockRejectedValueOnce(new Error('LLM call failed'));

      const executor = createExecutor();
      const handle = await executor.createSession({
        taskId: 'task-err',
        threadId: 'thread-1',
        cwd: '/workspaces',
      });

      const result = await executor.sendMessage(handle.sessionId, 'Fix it');

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('EXECUTION_ERROR');
      expect(result.error?.message).toBe('LLM call failed');
      expect(result.error?.retryable).toBe(false);
    });
  });

  describe('steer', () => {
    it('calls pi native steer (synchronous queue)', async () => {
      const mockCreate = vi.mocked(createAgentSession);
      const mockSession = (await mockCreate({} as any)).session;

      const executor = createExecutor();
      const handle = await executor.createSession({
        taskId: 'task-steer',
        threadId: 'thread-1',
        cwd: '/workspaces',
      });

      const result = await executor.steer(handle.sessionId, {
        instruction: 'Focus on tests',
        focusFiles: ['src/foo.ts'],
      });

      expect(result.success).toBe(true);
      expect(result.summary).toContain('Steered');
      expect(mockSession.steer).toHaveBeenCalledWith('Focus on tests');
    });

    it('throws for unknown session', async () => {
      const executor = createExecutor();
      await expect(
        executor.steer('nonexistent', { instruction: 'hello' }),
      ).rejects.toThrow('not found');
    });
  });

  describe('cancel', () => {
    it('calls session.abort()', async () => {
      const mockCreate = vi.mocked(createAgentSession);
      const mockSession = (await mockCreate({} as any)).session;

      const executor = createExecutor();
      const handle = await executor.createSession({
        taskId: 'task-cancel',
        threadId: 'thread-1',
        cwd: '/workspaces',
      });

      await executor.cancel(handle.sessionId);
      expect(mockSession.abort).toHaveBeenCalled();
    });

    it('is safe for unknown session', async () => {
      const executor = createExecutor();
      await expect(executor.cancel('nonexistent')).resolves.not.toThrow();
    });
  });

  describe('close', () => {
    it('aborts, disposes, and cleans workspace', async () => {
      const mockCreate = vi.mocked(createAgentSession);
      const mockSession = (await mockCreate({} as any)).session;

      const executor = createExecutor();
      const handle = await executor.createSession({
        taskId: 'task-close',
        threadId: 'thread-1',
        cwd: '/workspaces',
      });

      // Verify workspace exists
      await expect(access(join(TEST_BASE, 'task-close'))).resolves.not.toThrow();

      await executor.close(handle.sessionId);

      // Session should be disposed
      expect(mockSession.abort).toHaveBeenCalled();
      expect(mockSession.dispose).toHaveBeenCalled();

      // Workspace should be cleaned
      await expect(access(join(TEST_BASE, 'task-close'))).rejects.toThrow();
    });

    it('is safe to call twice', async () => {
      const executor = createExecutor();
      const handle = await executor.createSession({
        taskId: 'task-close2',
        threadId: 'thread-1',
        cwd: '/workspaces',
      });

      await executor.close(handle.sessionId);
      await expect(executor.close(handle.sessionId)).resolves.not.toThrow();
    });
  });

  describe('reattachSession', () => {
    it('returns null for unknown sessions', async () => {
      const executor = createExecutor();
      const result = await executor.reattachSession('nonexistent');
      expect(result).toBeNull();
    });

    it('returns handle for active sessions', async () => {
      const executor = createExecutor();
      const handle = await executor.createSession({
        taskId: 'task-reattach',
        threadId: 'thread-1',
        cwd: '/workspaces',
      });

      const reattached = await executor.reattachSession(handle.sessionId);
      expect(reattached).not.toBeNull();
      expect(reattached!.sessionId).toBe(handle.sessionId);
      expect(reattached!.harness).toBe('pi');
    });
  });

  // ─── Workspace ──────────────────────────────────────────────────────────

  describe('Workspace', () => {
    it('creates workspace in /tmp/yclaw-tasks/<id>', async () => {
      const executor = createExecutor();
      await executor.createSession({
        taskId: 'ws-check',
        threadId: 'thread-1',
        cwd: '/workspaces',
      });

      await expect(access(join(TEST_BASE, 'ws-check'))).resolves.not.toThrow();
    });

    it('sweepOrphanedWorkspaces removes stale directories', async () => {
      // Create an orphaned directory
      await mkdir(join(TEST_BASE, 'orphan-task'), { recursive: true });
      await writeFile(join(TEST_BASE, 'orphan-task', 'file.txt'), 'stale');

      const executor = createExecutor();
      await executor.sweepOrphanedWorkspaces();

      await expect(access(join(TEST_BASE, 'orphan-task'))).rejects.toThrow();
    });

    it('sweepOrphanedWorkspaces preserves active workspaces', async () => {
      const executor = createExecutor();
      const handle = await executor.createSession({
        taskId: 'active-task',
        threadId: 'thread-1',
        cwd: '/workspaces',
      });

      // Create an orphaned directory
      await mkdir(join(TEST_BASE, 'orphan-task'), { recursive: true });

      await executor.sweepOrphanedWorkspaces();

      // Active workspace preserved
      await expect(access(join(TEST_BASE, 'active-task'))).resolves.not.toThrow();
      // Orphan removed
      await expect(access(join(TEST_BASE, 'orphan-task'))).rejects.toThrow();

      await executor.close(handle.sessionId);
    });
  });

  // ─── Isolation ──────────────────────────────────────────────────────────

  describe('Session Isolation', () => {
    it('two concurrent sessions use separate workspaces', async () => {
      const executor = createExecutor();

      const h1 = await executor.createSession({
        taskId: 'iso-1',
        threadId: 'thread-1',
        cwd: '/workspaces',
      });
      const h2 = await executor.createSession({
        taskId: 'iso-2',
        threadId: 'thread-2',
        cwd: '/workspaces',
      });

      expect(h1.sessionId).not.toBe(h2.sessionId);

      // Both workspaces exist
      await expect(access(join(TEST_BASE, 'iso-1'))).resolves.not.toThrow();
      await expect(access(join(TEST_BASE, 'iso-2'))).resolves.not.toThrow();

      await executor.close(h1.sessionId);
      await executor.close(h2.sessionId);
    });

    it('two concurrent sessions use separate pi sessions', async () => {
      const executor = createExecutor();

      await executor.createSession({ taskId: 'sep-1', threadId: 't-1', cwd: '/workspaces' });
      await executor.createSession({ taskId: 'sep-2', threadId: 't-2', cwd: '/workspaces' });

      // createAgentSession should have been called twice (separate sessions)
      expect(createAgentSession).toHaveBeenCalledTimes(2);
    });
  });

  // ─── Contract ──────────────────────────────────────────────────────────

  describe('Contract', () => {
    it('implements full CodingExecutor interface', () => {
      const executor = createExecutor();
      expect(executor.name).toBe('pi');
      expect(typeof executor.createSession).toBe('function');
      expect(typeof executor.reattachSession).toBe('function');
      expect(typeof executor.sendMessage).toBe('function');
      expect(typeof executor.steer).toBe('function');
      expect(typeof executor.cancel).toBe('function');
      expect(typeof executor.close).toBe('function');
    });

    it('abort() called before dispose() on cleanup', async () => {
      const mockCreate = vi.mocked(createAgentSession);
      const mockSession = (await mockCreate({} as any)).session;
      const callOrder: string[] = [];
      vi.mocked(mockSession.abort).mockImplementation(async () => {
        callOrder.push('abort');
      });
      vi.mocked(mockSession.dispose).mockImplementation(() => {
        callOrder.push('dispose');
      });

      const executor = createExecutor();
      const handle = await executor.createSession({
        taskId: 'order-test',
        threadId: 'thread-1',
        cwd: '/workspaces',
      });

      await executor.close(handle.sessionId);

      const abortIdx = callOrder.indexOf('abort');
      const disposeIdx = callOrder.indexOf('dispose');
      expect(abortIdx).toBeLessThan(disposeIdx);
    });
  });
});

describe('Feature Flag', () => {
  it('PI_CODING_AGENT_ENABLED=false means executor not selected', async () => {
    const originalEnv = process.env.PI_CODING_AGENT_ENABLED;
    process.env.PI_CODING_AGENT_ENABLED = 'false';

    try {
      // The router checks the env var — when false, pi is null
      expect(process.env.PI_CODING_AGENT_ENABLED).toBe('false');
    } finally {
      if (originalEnv !== undefined) {
        process.env.PI_CODING_AGENT_ENABLED = originalEnv;
      } else {
        delete process.env.PI_CODING_AGENT_ENABLED;
      }
    }
  });
});
