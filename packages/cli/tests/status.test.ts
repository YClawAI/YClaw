import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Command } from 'commander';
import { registerStatusCommand } from '../src/commands/status.js';

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Track exit code
let exitCode: number | undefined;

// Capture console output
let consoleOutput: string[] = [];
let consoleErrors: string[] = [];

beforeEach(() => {
  consoleOutput = [];
  consoleErrors = [];
  exitCode = undefined;
  mockFetch.mockReset();

  vi.spyOn(console, 'log').mockImplementation((...args) => {
    consoleOutput.push(args.join(' '));
  });
  vi.spyOn(console, 'error').mockImplementation((...args) => {
    consoleErrors.push(args.join(' '));
  });
  vi.spyOn(process, 'exit').mockImplementation((code) => {
    exitCode = code as number;
    throw new Error(`EXIT_${code}`);
  });
});

function makeHealthyResponse() {
  return {
    status: 'healthy',
    uptimeSeconds: 3600,
    timestamp: '2026-04-02T19:00:00Z',
    components: {
      stateStore: { status: 'healthy', latencyMs: 12 },
      eventBus: { status: 'healthy', latencyMs: 3 },
      objectStore: { status: 'healthy', latencyMs: 1 },
    },
    channels: {
      discord: { status: 'healthy' },
      slack: { status: 'disabled' },
    },
    agents: { total: 12, active: 8, idle: 4, errored: 0 },
    tasks: { pending: 2, running: 1, failedLast24h: 3 },
    recentErrors: [],
  };
}

async function runStatus(args: string[]): Promise<void> {
  const program = new Command();
  program.exitOverride(); // Prevent commander from calling process.exit
  registerStatusCommand(program);
  try {
    await program.parseAsync(['node', 'yclaw', ...args]);
  } catch {
    // Expected — process.exit throws
  }
}

describe('yclaw status', () => {
  it('exits 0 when API returns healthy', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(makeHealthyResponse()),
    });

    await runStatus(['status', '--json', '--api-url', 'http://localhost:3000']);

    expect(exitCode).toBe(0);
    const jsonOutput = consoleOutput.join('\n');
    const parsed = JSON.parse(jsonOutput);
    expect(parsed.status).toBe('healthy');
  });

  it('exits 1 when API returns degraded', async () => {
    const data = makeHealthyResponse();
    data.status = 'degraded';
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(data),
    });

    await runStatus(['status', '--json', '--api-url', 'http://localhost:3000']);

    expect(exitCode).toBe(1);
  });

  it('exits 2 when API is unreachable', async () => {
    mockFetch.mockRejectedValue(new Error('fetch failed: ECONNREFUSED'));

    await runStatus(['status', '--json', '--api-url', 'http://localhost:9999']);

    expect(exitCode).toBe(2);
    const jsonOutput = consoleOutput.join('\n');
    const parsed = JSON.parse(jsonOutput);
    expect(parsed.type).toBe('unreachable');
  });

  it('exits 2 on auth error (401)', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 401,
      text: () => Promise.resolve('{"error":"Authentication required"}'),
    });

    await runStatus(['status', '--json', '--api-url', 'http://localhost:3000']);

    expect(exitCode).toBe(2);
    const jsonOutput = consoleOutput.join('\n');
    const parsed = JSON.parse(jsonOutput);
    expect(parsed.type).toBe('auth_error');
  });

  it('exits 2 on server error (500)', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      text: () => Promise.resolve('Internal server error'),
    });

    await runStatus(['status', '--json', '--api-url', 'http://localhost:3000']);

    expect(exitCode).toBe(2);
    const jsonOutput = consoleOutput.join('\n');
    const parsed = JSON.parse(jsonOutput);
    expect(parsed.type).toBe('server_error');
  });

  it('sends API key in X-Operator-Key header', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(makeHealthyResponse()),
    });

    await runStatus(['status', '--json', '--api-url', 'http://localhost:3000', '--api-key', 'test-key-123']);

    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:3000/v1/observability/health',
      expect.objectContaining({
        headers: expect.objectContaining({
          'X-Operator-Key': 'test-key-123',
        }),
      }),
    );
  });

  it('reads YCLAW_ROOT_API_KEY from env when no flag', async () => {
    const original = process.env.YCLAW_ROOT_API_KEY;
    process.env.YCLAW_ROOT_API_KEY = 'env-key-456';

    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(makeHealthyResponse()),
    });

    await runStatus(['status', '--json', '--api-url', 'http://localhost:3000']);

    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          'X-Operator-Key': 'env-key-456',
        }),
      }),
    );

    if (original === undefined) {
      delete process.env.YCLAW_ROOT_API_KEY;
    } else {
      process.env.YCLAW_ROOT_API_KEY = original;
    }
  });

  it('JSON output includes all expected fields', async () => {
    const data = makeHealthyResponse();
    data.recentErrors = [{
      timestamp: '2026-04-02T14:23:00Z',
      errorCode: 'LLM_TIMEOUT',
      message: 'Anthropic API timeout',
      agentId: 'architect',
      category: 'llm',
      severity: 'warning',
      action: 'Retry or switch provider',
    }];

    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(data),
    });

    await runStatus(['status', '--json', '--api-url', 'http://localhost:3000']);

    const jsonOutput = consoleOutput.join('\n');
    const parsed = JSON.parse(jsonOutput);
    expect(parsed.components).toBeDefined();
    expect(parsed.channels).toBeDefined();
    expect(parsed.agents).toBeDefined();
    expect(parsed.tasks).toBeDefined();
    expect(parsed.recentErrors.length).toBe(1);
    expect(parsed.recentErrors[0].errorCode).toBe('LLM_TIMEOUT');
  });
});
