import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { basename, join } from 'node:path';

const RUNTIME_NAME = 'process';
const OUTPUT_BUFFER_LINES = 500;

/**
 * runtime-process — Subprocess-based AO runtime plugin.
 *
 * Replaces runtime-tmux for headless ECS Fargate containers.
 * Supports two communication patterns:
 *
 * 1. PERSISTENT (Pi RPC): Long-running process, bidirectional stdin/stdout
 *    - sendMessage() writes JSON to stdin
 *    - Output streams as JSONL events
 *
 * 2. SEQUENTIAL (Claude Code -p): One-shot process per task
 *    - sendMessage() re-spawns with the message as new task
 *    - Output captured from stdout on exit
 */
class RuntimeProcess {
  constructor() {
    this.name = RUNTIME_NAME;
    this.sessions = new Map(); // sessionId → SessionState
  }

  /**
   * Spawn a new subprocess session.
   * The launchCommand comes from the agent plugin's getLaunchCommand().
   */
  async create(config) {
    const { sessionId, workspacePath, launchCommand, environment } = config;

    // Determine communication pattern from launch command
    const isPersistent = launchCommand.includes('--mode rpc') ||
                         launchCommand.includes('--mode=rpc');

    // Parse command and args from the launch command string
    const { cmd, args } = this._parseLaunchCommand(launchCommand);

    // Create log directory for this session
    const logDir = join(process.env.HOME || '/data/ao-home', '.ao-sessions', sessionId);
    mkdirSync(logDir, { recursive: true });

    const session = {
      id: sessionId,
      workspacePath,
      isPersistent,
      process: null,
      outputBuffer: [],
      outputLog: join(logDir, 'output.jsonl'),
      stderrLog: join(logDir, 'stderr.log'),
      launchCommand,
      cmd,
      args,
      environment: { ...process.env, ...environment },
      alive: false,
      exitCode: null,
      events: new EventEmitter(),
      pendingMessages: [], // For sequential mode: queued messages
      spawnCount: 0,
      createdAt: Date.now(),
      promptDeliveredAtCreate: false, // Track if prompt was already sent during create()
    };

    this.sessions.set(sessionId, session);

    // For post-launch prompt delivery (claude-code adapter), the session-manager
    // waits 5s then calls sendMessage(). But Claude Code auto-enters headless mode
    // on piped stdio and times out stdin after 3s. To win the race: if a prompt is
    // available at create time, build one-shot args and spawn immediately.
    if (!session.isPersistent && !this._hasInlinePrompt(session.args) && config.prompt) {
      console.log(`[runtime-process] Session ${sessionId}: prompt available at create time, spawning with -p immediately`);
      session.args = this._buildOneShotArgs(session.cmd, config.prompt);
      session.promptDeliveredAtCreate = true;
      await this._spawn(session);
    } else if (session.isPersistent || this._hasInlinePrompt(session.args)) {
      this._warnIfStdinRequired(session.args, sessionId);
      await this._spawn(session);
    } else {
      console.warn(
        `[runtime-process] Session ${sessionId} created without inline prompt. ` +
        `Deferring spawn until sendMessage() provides the task.`,
      );
    }

    return {
      id: sessionId,
      runtimeName: RUNTIME_NAME,
      data: {
        pid: session.process?.pid,
        isPersistent,
        logDir,
      },
    };
  }

  /**
   * Internal: spawn or re-spawn a subprocess.
   */
  async _spawn(session) {
    const { cmd, args, workspacePath, environment, outputLog, stderrLog } = session;

    // Guard: verify workspace exists before spawning. Missing workspaces cause
    // confusing ENOENT errors from the child process rather than a clear message.
    if (!existsSync(workspacePath)) {
      const missing = new Error(
        `[runtime-process] Session ${session.id} workspace missing: ${workspacePath}. ` +
        `The worktree may have been removed during an active session.`,
      );
      session.alive = false;
      console.error(missing.message);
      session.events.emit('error', missing);
      return;
    }

    session.spawnCount++;
    console.log(`[runtime-process] Spawning session ${session.id} (attempt ${session.spawnCount}): ${cmd} ${args.join(' ')}`);

    const proc = spawn(cmd, args, {
      cwd: workspacePath,
      env: environment,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    session.process = proc;
    session.alive = true;
    session.exitCode = null;

    // Capture stdout with proper NDJSON line buffering
    let stdoutPartial = '';

    proc.stdout.on('data', (chunk) => {
      const text = stdoutPartial + chunk.toString();
      const lines = text.split('\n');
      stdoutPartial = lines.pop(); // Keep incomplete tail for next chunk

      for (const line of lines) {
        const trimmed = line.replace(/\r$/, ''); // Handle \r\n
        if (!trimmed) continue;

        session.outputBuffer.push(trimmed);
        if (session.outputBuffer.length > OUTPUT_BUFFER_LINES) {
          session.outputBuffer.shift();
        }
        try { appendFileSync(outputLog, trimmed + '\n'); } catch {}
      }

      session.events.emit('output', chunk.toString());
    });

    // Capture stderr
    proc.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      try { appendFileSync(stderrLog, text); } catch {}
      session.events.emit('stderr', text);
    });

    // Handle process exit — flush partial buffer
    proc.on('close', (code) => {
      if (stdoutPartial.trim()) {
        session.outputBuffer.push(stdoutPartial.trim());
        try { appendFileSync(outputLog, stdoutPartial.trim() + '\n'); } catch {}
      }
      stdoutPartial = '';

      console.log(`[runtime-process] Session ${session.id} exited with code ${code}`);
      session.alive = false;
      session.exitCode = code;
      session.events.emit('exit', code);
    });

    proc.on('error', (err) => {
      console.error(`[runtime-process] Session ${session.id} spawn error:`, err.message);
      session.alive = false;
      session.events.emit('error', err);
    });

    // For persistent processes (Pi RPC), wait a moment for startup
    if (session.isPersistent) {
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }

  /**
   * Send a message to the running session.
   *
   * For PERSISTENT (Pi RPC): writes JSON command to stdin
   * For SEQUENTIAL (Claude Code): re-spawns with the message as new task
   */
  async sendMessage(handle, message) {
    const session = this.sessions.get(handle.id);
    if (!session) throw new Error(`Session ${handle.id} not found`);

    if (session.isPersistent) {
      // Pi RPC: write to stdin
      if (!session.alive || !session.process) {
        throw new Error(`Session ${handle.id} is not alive`);
      }

      const rpcMessage = {
        type: 'prompt',
        message: message,
      };

      const jsonLine = JSON.stringify(rpcMessage) + '\n';
      session.process.stdin.write(jsonLine);
      console.log(`[runtime-process] Sent RPC message to ${handle.id}: ${message.slice(0, 100)}...`);

    } else {
      // Claude Code -p: re-spawn with new task
      // If prompt was already delivered during create(), skip this re-spawn
      // to avoid killing a session that's already working on the task.
      if (session.promptDeliveredAtCreate && session.alive) {
        console.log(`[runtime-process] Skipping sendMessage re-spawn for ${handle.id} — prompt already delivered at create time`);
        session.promptDeliveredAtCreate = false; // Allow future sendMessage calls
        return;
      }

      console.log(`[runtime-process] Sequential re-spawn for ${handle.id}, task length: ${message?.length ?? 'null'}, preview: ${JSON.stringify((message || '').slice(0, 200))}`);

      // Kill current process if still running
      if (session.alive && session.process) {
        session.process.kill('SIGTERM');
        await new Promise(resolve => {
          session.events.once('exit', resolve);
          setTimeout(resolve, 5000); // Force after 5s
        });
      }

      // Validate before building args — provides a clear diagnostic instead of
      // letting claude silently wait for stdin input.
      if (!message || typeof message !== 'string' || !message.trim()) {
        throw new Error(
          `[runtime-process] sendMessage() called with empty task for session ${handle.id}. ` +
          `Provide a non-empty string to avoid stdin blocking failures.`,
        );
      }

      // Update args with new message
      session.args = this._buildOneShotArgs(session.cmd, message);
      this._warnIfStdinRequired(session.args, handle.id);
      await this._spawn(session);

      // Update the handle's PID reference to the new process
      handle.data.pid = session.process?.pid;

      console.log(`[runtime-process] Re-spawned ${handle.id} with new task (new PID: ${handle.data.pid}): ${message.slice(0, 100)}...`);
    }
  }

  /**
   * Get recent output from the session.
   */
  async getOutput(handle, lines) {
    const session = this.sessions.get(handle.id);
    if (!session) return '';

    const count = lines || OUTPUT_BUFFER_LINES;
    return session.outputBuffer.slice(-count).join('\n');
  }

  /**
   * Check if the session subprocess is still running.
   */
  async isAlive(handle) {
    const session = this.sessions.get(handle.id);
    if (!session) return false;
    return session.alive;
  }

  /**
   * Destroy/kill a session.
   */
  async destroy(handle) {
    const session = this.sessions.get(handle.id);
    if (!session) return;

    if (session.alive && session.process) {
      // For Pi RPC, send abort first
      if (session.isPersistent) {
        try {
          session.process.stdin.write(JSON.stringify({ type: 'abort' }) + '\n');
          await new Promise(resolve => setTimeout(resolve, 2000));
        } catch {}
      }

      session.process.kill('SIGTERM');

      // Wait for graceful exit, then force
      await new Promise(resolve => {
        const timeout = setTimeout(() => {
          if (session.alive) session.process.kill('SIGKILL');
          resolve();
        }, 5000);
        session.events.once('exit', () => { clearTimeout(timeout); resolve(); });
      });
    }

    this.sessions.delete(handle.id);
    console.log(`[runtime-process] Destroyed session ${handle.id}`);
  }

  /**
   * Get runtime metrics.
   */
  async getMetrics(handle) {
    const session = this.sessions.get(handle.id);
    if (!session) return { uptimeMs: 0 };
    return {
      uptimeMs: Date.now() - session.createdAt,
      spawnCount: session.spawnCount,
    };
  }

  /**
   * Get attach info (for debugging — not interactive).
   */
  async getAttachInfo(handle) {
    const session = this.sessions.get(handle.id);
    return {
      type: 'process',
      target: session?.process?.pid?.toString() || 'unknown',
      command: `tail -f ${session?.outputLog || 'unknown'}`,
    };
  }

  // ── Helpers ──────────────────────────────────────────────────────────

  _parseLaunchCommand(launchCommand) {
    const parts = launchCommand.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || [];
    const cmd = parts[0];
    const args = parts.slice(1).map(a => a.replace(/^["']|["']$/g, ''));
    return { cmd, args };
  }

  _buildOneShotArgs(cmd, task) {
    // Match 'claude' regardless of whether a full path was provided
    // (e.g. /usr/local/bin/claude, ./node_modules/.bin/claude).
    if (cmd === 'claude' || basename(cmd) === 'claude') {
      if (!task || typeof task !== 'string' || !task.trim()) {
        throw new Error(
          `[runtime-process] Claude Code requires a non-empty task prompt for one-shot execution. ` +
          `Received: ${JSON.stringify(task)}. ` +
          `Ensure sendMessage() is called with a valid task string before spawning.`,
        );
      }
      // Use -p (inline prompt) so claude never blocks on stdin.
      return [
        '--bare',
        '-p', task.trim(),
        '--output-format', 'json',
        '--max-turns', process.env.AO_MAX_TURNS || '60',
        '--dangerously-skip-permissions',
      ];
    }
    return [task];
  }

  /**
   * Log a diagnostic warning when the process is about to be spawned in a
   * way that would require stdin input (i.e. --print/--bare without -p).
   * This is the root cause of "no stdin data received in 3s" failures.
   */
  _warnIfStdinRequired(args, sessionId) {
    const hasPrintFlag = args.includes('--print') || args.includes('--bare');
    const hasInlinePrompt = this._hasInlinePrompt(args);
    if (hasPrintFlag && !hasInlinePrompt) {
      console.warn(
        `[runtime-process] WARNING: session ${sessionId} will be spawned with ` +
        `${args.includes('--print') ? '--print' : '--bare'} but no -p/--print inline prompt. ` +
        `Claude will block waiting for stdin and may emit "no stdin data received in 3s". ` +
        `Call sendMessage() with a valid task instead of spawning directly.`,
      );
    }
  }

  _hasInlinePrompt(args) {
    for (let i = 0; i < args.length; i += 1) {
      const arg = args[i];
      // -p / --print accept the prompt as the immediately following argument.
      // --print=<value> (equals-delimited) is not used by the Claude CLI but
      // guard against it to stay defensive.
      if (arg === '-p' || arg === '--print') {
        const next = args[i + 1];
        if (typeof next === 'string' && next.trim() && !next.startsWith('-')) {
          return true;
        }
      }
    }
    return false;
  }
}

// Export for AO plugin system
export function create() {
  return new RuntimeProcess();
}

export const manifest = {
  name: 'process',
  slot: 'runtime',
  description: 'Subprocess runtime for headless containers (ECS Fargate)',
  version: '0.1.0',
};

export default { manifest, create };
