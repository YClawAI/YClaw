import { describe, expect, it } from 'vitest';

/**
 * Unit tests for runtime-process.mjs helpers.
 *
 * We test the pure helper methods in isolation by instantiating
 * the RuntimeProcess class directly (without spawning real processes).
 */

// Dynamically import so we can call create() as the plugin system does.
const { create } = await import('./runtime-process.mjs');

function makeRuntime() {
  return create();
}

// ── _parseLaunchCommand ───────────────────────────────────────────────────────

describe('_parseLaunchCommand', () => {
  it('splits a simple space-separated command', () => {
    const rt = makeRuntime();
    const { cmd, args } = rt._parseLaunchCommand('claude --bare -p hello');
    expect(cmd).toBe('claude');
    expect(args).toEqual(['--bare', '-p', 'hello']);
  });

  it('preserves double-quoted arguments and strips outer quotes', () => {
    const rt = makeRuntime();
    const { cmd, args } = rt._parseLaunchCommand('claude --bare -p "do something useful"');
    expect(cmd).toBe('claude');
    expect(args).toContain('do something useful');
  });

  it('handles single-quoted arguments', () => {
    const rt = makeRuntime();
    const { cmd, args } = rt._parseLaunchCommand("claude --bare -p 'task text'");
    expect(args).toContain('task text');
  });

  it('handles a full binary path as the command', () => {
    const rt = makeRuntime();
    const { cmd } = rt._parseLaunchCommand('/usr/local/bin/claude --bare');
    expect(cmd).toBe('/usr/local/bin/claude');
  });
});

// ── _hasInlinePrompt ──────────────────────────────────────────────────────────

describe('_hasInlinePrompt', () => {
  it('returns true when -p is followed by a non-empty string', () => {
    const rt = makeRuntime();
    expect(rt._hasInlinePrompt(['--bare', '-p', 'do the thing'])).toBe(true);
  });

  it('returns true when --print is followed by a non-empty string', () => {
    const rt = makeRuntime();
    expect(rt._hasInlinePrompt(['--print', 'do the thing'])).toBe(true);
  });

  it('returns false when -p is the last argument (no value)', () => {
    const rt = makeRuntime();
    expect(rt._hasInlinePrompt(['--bare', '-p'])).toBe(false);
  });

  it('returns false when -p is followed by an empty string', () => {
    const rt = makeRuntime();
    expect(rt._hasInlinePrompt(['--bare', '-p', ''])).toBe(false);
  });

  it('returns false when -p is followed by a whitespace-only string', () => {
    const rt = makeRuntime();
    expect(rt._hasInlinePrompt(['--bare', '-p', '   '])).toBe(false);
  });

  it('returns false when -p is followed by another flag', () => {
    const rt = makeRuntime();
    // A dash-prefixed next arg is a flag, not a prompt value.
    expect(rt._hasInlinePrompt(['--bare', '-p', '--output-format', 'json'])).toBe(false);
  });

  it('returns false when no -p or --print is present', () => {
    const rt = makeRuntime();
    expect(rt._hasInlinePrompt(['--bare', '--output-format', 'json'])).toBe(false);
  });
});

// ── _buildOneShotArgs ─────────────────────────────────────────────────────────

describe('_buildOneShotArgs', () => {
  it('builds correct args for the claude binary name', () => {
    const rt = makeRuntime();
    const args = rt._buildOneShotArgs('claude', 'fix the build');
    expect(args).toContain('-p');
    expect(args[args.indexOf('-p') + 1]).toBe('fix the build');
    expect(args).toContain('--bare');
    expect(args).toContain('--dangerously-skip-permissions');
  });

  it('builds correct args when a full path to claude is given', () => {
    const rt = makeRuntime();
    const args = rt._buildOneShotArgs('/usr/local/bin/claude', 'fix the build');
    expect(args).toContain('-p');
    expect(args[args.indexOf('-p') + 1]).toBe('fix the build');
  });

  it('trims whitespace from the task', () => {
    const rt = makeRuntime();
    const args = rt._buildOneShotArgs('claude', '  spaced task  ');
    expect(args[args.indexOf('-p') + 1]).toBe('spaced task');
  });

  it('throws when the task is empty', () => {
    const rt = makeRuntime();
    expect(() => rt._buildOneShotArgs('claude', '')).toThrow(/non-empty task prompt/);
  });

  it('throws when the task is whitespace-only', () => {
    const rt = makeRuntime();
    expect(() => rt._buildOneShotArgs('claude', '   ')).toThrow(/non-empty task prompt/);
  });

  it('throws when the task is null', () => {
    const rt = makeRuntime();
    expect(() => rt._buildOneShotArgs('claude', null)).toThrow(/non-empty task prompt/);
  });

  it('throws when the task is undefined', () => {
    const rt = makeRuntime();
    expect(() => rt._buildOneShotArgs('claude', undefined)).toThrow(/non-empty task prompt/);
  });

  it('returns [task] for non-claude commands (stdin pass-through for Pi RPC)', () => {
    const rt = makeRuntime();
    const args = rt._buildOneShotArgs('pi', 'some task');
    expect(args).toEqual(['some task']);
  });

  it('the generated args have -p before the prompt (no accidental stdin usage)', () => {
    const rt = makeRuntime();
    const args = rt._buildOneShotArgs('claude', 'run the tests');
    // Must include the -p flag so claude does not block on stdin.
    const pIdx = args.indexOf('-p');
    expect(pIdx).toBeGreaterThan(-1);
    expect(args[pIdx + 1]).toBe('run the tests');
    // _hasInlinePrompt should agree.
    const rt2 = makeRuntime();
    expect(rt2._hasInlinePrompt(args)).toBe(true);
  });
});

// ── _warnIfStdinRequired ──────────────────────────────────────────────────────

describe('_warnIfStdinRequired', () => {
  it('emits a console.warn when --print is present without -p', () => {
    const rt = makeRuntime();
    const warnings = [];
    const originalWarn = console.warn;
    console.warn = (...args) => warnings.push(args.join(' '));
    try {
      rt._warnIfStdinRequired(['--print', '--output-format', 'json'], 'sess-1');
    } finally {
      console.warn = originalWarn;
    }
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0]).toContain('stdin');
  });

  it('emits a console.warn when --bare is present without -p', () => {
    const rt = makeRuntime();
    const warnings = [];
    const originalWarn = console.warn;
    console.warn = (...args) => warnings.push(args.join(' '));
    try {
      rt._warnIfStdinRequired(['--bare', '--output-format', 'json'], 'sess-2');
    } finally {
      console.warn = originalWarn;
    }
    expect(warnings.length).toBeGreaterThan(0);
  });

  it('does not warn when -p is present alongside --bare', () => {
    const rt = makeRuntime();
    const warnings = [];
    const originalWarn = console.warn;
    console.warn = (...args) => warnings.push(args.join(' '));
    try {
      rt._warnIfStdinRequired(['--bare', '-p', 'do something', '--output-format', 'json'], 'sess-3');
    } finally {
      console.warn = originalWarn;
    }
    expect(warnings.length).toBe(0);
  });
});

// ── sendMessage validation ────────────────────────────────────────────────────

describe('sendMessage empty-prompt guard', () => {
  it('throws synchronously before re-spawning when message is empty', async () => {
    const rt = makeRuntime();

    // Create a minimal fake sequential session in the internal map.
    const fakeHandle = { id: 'test-seq-session', data: { pid: null, isPersistent: false } };
    rt.sessions.set('test-seq-session', {
      id: 'test-seq-session',
      isPersistent: false,
      alive: false,
      process: null,
      args: [],
      cmd: 'claude',
      workspacePath: '/tmp',
      environment: {},
      outputBuffer: [],
      outputLog: '/tmp/out.jsonl',
      stderrLog: '/tmp/err.log',
      launchCommand: 'claude --bare',
      spawnCount: 0,
      createdAt: Date.now(),
      events: { once: () => {} },
      pendingMessages: [],
    });

    await expect(rt.sendMessage(fakeHandle, '')).rejects.toThrow(/empty task/);
    await expect(rt.sendMessage(fakeHandle, '   ')).rejects.toThrow(/empty task/);
    await expect(rt.sendMessage(fakeHandle, null)).rejects.toThrow(/empty task/);
  });
});

// ── promptDeliveredAtCreate skip-respawn ──────────────────────────────────────

describe('sendMessage promptDeliveredAtCreate skip-respawn', () => {
  it('skips re-spawn and clears the flag when promptDeliveredAtCreate is true and session is alive', async () => {
    const rt = makeRuntime();

    const spawnCalls = [];
    // Patch _spawn so we can detect any re-spawn attempts without forking a process.
    rt._spawn = async (session) => { spawnCalls.push(session.id); };

    const fakeHandle = { id: 'pre-delivered-session', data: { pid: 42, isPersistent: false } };
    rt.sessions.set('pre-delivered-session', {
      id: 'pre-delivered-session',
      isPersistent: false,
      alive: true,
      process: { pid: 42, kill: () => {} },
      args: ['--bare', '-p', 'original task'],
      cmd: 'claude',
      workspacePath: '/tmp',
      environment: {},
      outputBuffer: [],
      outputLog: '/tmp/out.jsonl',
      stderrLog: '/tmp/err.log',
      launchCommand: 'claude --bare',
      spawnCount: 1,
      createdAt: Date.now(),
      events: { once: () => {} },
      pendingMessages: [],
      promptDeliveredAtCreate: true,
    });

    // sendMessage should be a no-op (flag was true + session alive)
    await rt.sendMessage(fakeHandle, 'new task here');
    expect(spawnCalls).toHaveLength(0);

    // Flag should be cleared to allow future sendMessage calls to work normally.
    const session = rt.sessions.get('pre-delivered-session');
    expect(session.promptDeliveredAtCreate).toBe(false);
  });

  it('proceeds with re-spawn on the second sendMessage after the flag is cleared', async () => {
    const rt = makeRuntime();

    const spawnCalls = [];
    rt._spawn = async (session) => {
      spawnCalls.push(session.id);
      session.alive = true;
      session.process = { pid: 99 };
    };

    const fakeHandle = { id: 'cleared-flag-session', data: { pid: 42, isPersistent: false } };
    rt.sessions.set('cleared-flag-session', {
      id: 'cleared-flag-session',
      isPersistent: false,
      alive: true,
      process: { pid: 42, kill: () => {} },
      args: ['--bare', '-p', 'original task'],
      cmd: 'claude',
      workspacePath: '/tmp',
      environment: {},
      outputBuffer: [],
      outputLog: '/tmp/out.jsonl',
      stderrLog: '/tmp/err.log',
      launchCommand: 'claude --bare',
      spawnCount: 1,
      createdAt: Date.now(),
      events: { once: (ev, cb) => { cb(0); } }, // immediately resolves exit
      pendingMessages: [],
      promptDeliveredAtCreate: true,
    });

    // First call: skipped, flag cleared.
    await rt.sendMessage(fakeHandle, 'first call skipped');
    expect(spawnCalls).toHaveLength(0);

    // Second call: flag is now false, so re-spawn should occur.
    await rt.sendMessage(fakeHandle, 'second call spawns');
    expect(spawnCalls).toHaveLength(1);
    expect(spawnCalls[0]).toBe('cleared-flag-session');
  });
});

// ── getOutput / isAlive / getMetrics ─────────────────────────────────────────

describe('getOutput', () => {
  it('returns the buffered output lines for a session', async () => {
    const rt = makeRuntime();
    const fakeHandle = { id: 'output-session' };
    rt.sessions.set('output-session', {
      outputBuffer: ['line one', 'line two', 'line three'],
      alive: true,
    });

    const out = await rt.getOutput(fakeHandle, 10);
    expect(out).toContain('line one');
    expect(out).toContain('line three');
  });

  it('returns empty string for unknown session', async () => {
    const rt = makeRuntime();
    const out = await rt.getOutput({ id: 'nonexistent' }, 10);
    expect(out).toBe('');
  });

  it('returns only the last N lines when more than N lines are buffered', async () => {
    const rt = makeRuntime();
    const fakeHandle = { id: 'trim-session' };
    rt.sessions.set('trim-session', {
      outputBuffer: ['a', 'b', 'c', 'd', 'e'],
      alive: true,
    });

    const out = await rt.getOutput(fakeHandle, 2);
    expect(out).toBe('d\ne');
  });
});

describe('isAlive', () => {
  it('returns true when the session is alive', async () => {
    const rt = makeRuntime();
    const fakeHandle = { id: 'alive-session' };
    rt.sessions.set('alive-session', { alive: true });
    expect(await rt.isAlive(fakeHandle)).toBe(true);
  });

  it('returns false when the session has exited', async () => {
    const rt = makeRuntime();
    const fakeHandle = { id: 'dead-session' };
    rt.sessions.set('dead-session', { alive: false });
    expect(await rt.isAlive(fakeHandle)).toBe(false);
  });

  it('returns false for an unknown session id', async () => {
    const rt = makeRuntime();
    expect(await rt.isAlive({ id: 'no-such-session' })).toBe(false);
  });
});

describe('getMetrics', () => {
  it('returns uptimeMs and spawnCount for an existing session', async () => {
    const rt = makeRuntime();
    const fakeHandle = { id: 'metrics-session' };
    rt.sessions.set('metrics-session', {
      createdAt: Date.now() - 5000,
      spawnCount: 3,
    });

    const metrics = await rt.getMetrics(fakeHandle);
    expect(metrics.uptimeMs).toBeGreaterThanOrEqual(5000);
    expect(metrics.spawnCount).toBe(3);
  });

  it('returns zero uptimeMs for an unknown session', async () => {
    const rt = makeRuntime();
    const metrics = await rt.getMetrics({ id: 'unknown' });
    expect(metrics.uptimeMs).toBe(0);
  });
});

// ── Input handling — stdin avoidance end-to-end ───────────────────────────────
//
// These tests exercise the full invariant chain described in CLAUDE.md:
//   _buildOneShotArgs always sets -p → _hasInlinePrompt agrees → no stdin needed.

describe('stdin avoidance invariants', () => {
  it('every arg set built by _buildOneShotArgs passes _hasInlinePrompt', () => {
    const rt = makeRuntime();
    const tasks = [
      'fix the build',
      'add tests for the new endpoint',
      'refactor the auth module',
      '   leading and trailing spaces   ',
    ];

    for (const task of tasks) {
      const args = rt._buildOneShotArgs('claude', task);
      expect(rt._hasInlinePrompt(args)).toBe(true);
    }
  });

  it('_warnIfStdinRequired does not warn for args built by _buildOneShotArgs', () => {
    const rt = makeRuntime();
    const warnings = [];
    const originalWarn = console.warn;
    console.warn = (...args) => warnings.push(args.join(' '));

    try {
      const args = rt._buildOneShotArgs('claude', 'do something');
      rt._warnIfStdinRequired(args, 'test-session');
    } finally {
      console.warn = originalWarn;
    }

    expect(warnings).toHaveLength(0);
  });

  it('a round-trip through parseLaunchCommand preserves the -p flag', () => {
    const rt = makeRuntime();
    const originalArgs = rt._buildOneShotArgs('claude', 'my task');
    const reconstructed = ['claude', ...originalArgs].join(' ');
    const { cmd, args } = rt._parseLaunchCommand(reconstructed);
    expect(cmd).toBe('claude');
    expect(rt._hasInlinePrompt(args)).toBe(true);
  });
});
