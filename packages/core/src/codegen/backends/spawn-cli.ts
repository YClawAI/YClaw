import { spawn } from 'node:child_process';
import { createLogger } from '../../logging/logger.js';

const logger = createLogger('spawn-cli');

// ─── Shared CLI Subprocess Wrapper ──────────────────────────────────────────
//
// Spawns a CLI tool as a child process with:
//   - AbortController-based timeout
//   - stdout/stderr capture
//   - Credential scoping via env
//   - Duration tracking
//

export interface SpawnCliParams {
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  timeout_ms: number;
}

export interface SpawnCliResult {
  exit_code: number;
  stdout: string;
  stderr: string;
  duration_ms: number;
  timed_out: boolean;
}

/** Hard ceiling: no subprocess runs longer than 30 minutes */
const MAX_TIMEOUT_MS = 30 * 60 * 1000;

/** Redact credentials from git URLs and credential.helper args before logging. */
function redactArgs(args: string[]): string[] {
  return args.map(arg =>
    arg.replace(/https:\/\/[^:\s]+:[^@\s]+@/g, 'https://***:***@')
       .replace(/credential\.helper=store --file=\S+/g, 'credential.helper=store --file=***'),
  );
}

export async function spawnCli(params: SpawnCliParams): Promise<SpawnCliResult> {
  const timeout = Math.min(params.timeout_ms, MAX_TIMEOUT_MS);
  const ac = new AbortController();

  logger.info('Spawning CLI', {
    command: params.command,
    args: redactArgs(params.args),
    cwd: params.cwd,
    timeout_ms: timeout,
  });

  const start = Date.now();

  return new Promise<SpawnCliResult>((resolve) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      ac.abort();
    }, timeout);

    // Scoped env: only pass what the subprocess needs
    const childEnv: Record<string, string> = {
      PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin',
      HOME: process.env.HOME || '/home/node',
      NODE_ENV: 'production',
      ...params.env,
    };

    const child = spawn(params.command, params.args, {
      cwd: params.cwd,
      env: childEnv,
      signal: ac.signal,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      const duration_ms = Date.now() - start;

      logger.info('CLI process exited', {
        command: params.command,
        exit_code: code ?? 1,
        duration_ms,
        timed_out: timedOut,
        stdout_bytes: stdout.length,
        stderr_bytes: stderr.length,
      });

      resolve({
        exit_code: code ?? 1,
        stdout,
        stderr,
        duration_ms,
        timed_out: timedOut,
      });
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      const duration_ms = Date.now() - start;

      logger.error('CLI process error', {
        command: params.command,
        error: err.message,
      });

      resolve({
        exit_code: 1,
        stdout,
        stderr: stderr + `\n${err.message}`,
        duration_ms,
        timed_out: timedOut,
      });
    });
  });
}
