/**
 * YClaw-safe Bash tool for pi-coding-agent.
 * Sandboxed command execution with secret scrubbing.
 *
 * MOST CRITICAL tool — this is the primary attack surface.
 */

import { spawn } from 'node:child_process';
import { Type, type Static } from '@sinclair/typebox';
import type { ToolDefinition, AgentToolResult } from '@mariozechner/pi-coding-agent';
import type { YClawToolConfig } from './types.js';

const BashParams = Type.Object({
  command: Type.String({ description: 'Shell command to execute' }),
  timeout: Type.Optional(Type.Number({ description: 'Timeout in ms (default: 30000)' })),
});

/** Env var names that likely contain secrets. Matched case-insensitively. */
const SECRET_ENV_PATTERNS = [
  /api[_-]?key/i,
  /secret/i,
  /token/i,
  /password/i,
  /credential/i,
  /private[_-]?key/i,
  /auth/i,
  /^AWS_/i,
  /^ANTHROPIC_/i,
  /^OPENAI_/i,
  /^GITHUB_TOKEN$/i,
  /^GH_TOKEN$/i,
  /^SLACK_/i,
  /^MONGO/i,
  /^REDIS_URL$/i,
  /^DATABASE_URL$/i,
  // ECS/Fargate metadata — leaks IAM credentials and infra info
  /^AWS_CONTAINER_CREDENTIALS/i,
  /^ECS_CONTAINER_METADATA/i,
  /^AWS_EXECUTION_ENV/i,
  /^AWS_DEFAULT_REGION/i,
];

/** Commands that are blocked entirely. */
const BLOCKED_COMMANDS = [
  /\bdocker\b/,
  /\bpodman\b/,
  /\bkubectl\b/,
  /\brm\s+-rf\s+\/(?!\tmp)/,          // rm -rf / (but allow /tmp)
  /\bmkfs\b/,
  /\bdd\b.*\bof=\/dev\//,
  /\bshutdown\b/,
  /\breboot\b/,
  // Network tools — block entirely to prevent SSRF / AWS metadata theft.
  // Agent doesn't need network access; all work is local filesystem + git.
  /\bcurl\b/,
  /\bwget\b/,
  /\bnc\b/,
  /\bncat\b/,
  /\bsocat\b/,
  // AWS/cloud metadata endpoints
  /169\.254\./,                         // AWS metadata service
  /metadata\.google/,                   // GCP metadata service
  // Python network escape hatches
  /python.*\burllib\b/,
  /python.*\brequests\b/,
  /python.*\bhttp\.client\b/,
  /python.*\bsocket\b/,
];

/**
 * Scrub secret values from environment variables.
 * Returns a new env object with secret vars removed.
 */
function scrubSecrets(env: NodeJS.ProcessEnv): Record<string, string> {
  const scrubbed: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) continue;
    const isSecret = SECRET_ENV_PATTERNS.some((pattern) => pattern.test(key));
    if (!isSecret) {
      scrubbed[key] = value;
    }
  }
  return scrubbed;
}

/**
 * Check if a command is blocked by the safety blocklist.
 */
function isBlockedCommand(command: string): string | null {
  for (const pattern of BLOCKED_COMMANDS) {
    if (pattern.test(command)) {
      return `Command matches blocked pattern: ${pattern.source}`;
    }
  }
  return null;
}

export function createYClawBashTool(config: YClawToolConfig): ToolDefinition {
  return {
    name: 'yclaw-bash',
    label: 'Bash',
    description: 'Execute a shell command in the workspace. Commands run in the workspace directory with secrets scrubbed from the environment.',
    parameters: BashParams,
    execute: async (
      _toolCallId: string,
      params: Static<typeof BashParams>,
      signal: AbortSignal | undefined,
      _onUpdate: unknown,
      _ctx: unknown,
    ): Promise<AgentToolResult<Record<string, unknown>>> => {
      // Check command blocklist
      const blockReason = isBlockedCommand(params.command);
      if (blockReason) {
        config.auditLogger?.('yclaw-bash', params.command, `blocked:${blockReason}`);
        return {
          content: [{ type: 'text', text: `Blocked: ${blockReason}` }],
          details: { exitCode: 1, blocked: true },
        };
      }

      const timeoutMs = params.timeout ?? 30_000;

      try {
        const result = await execInSandbox(params.command, {
          cwd: config.workspaceRoot,
          timeout: timeoutMs,
          env: scrubSecrets(process.env),
          signal,
        });

        config.auditLogger?.('yclaw-bash', params.command, result.exitCode === 0 ? 'success' : 'error');

        // Truncate very long output to avoid context overflow
        const maxOutput = 100_000;
        let output = result.stdout;
        if (result.stderr) {
          output += `\nSTDERR:\n${result.stderr}`;
        }
        if (output.length > maxOutput) {
          output = output.slice(0, maxOutput) + `\n... (truncated, ${output.length - maxOutput} bytes omitted)`;
        }

        return {
          content: [{ type: 'text', text: output || '(no output)' }],
          details: { exitCode: result.exitCode, timedOut: result.timedOut },
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        config.auditLogger?.('yclaw-bash', params.command, `error:${msg}`);
        return {
          content: [{ type: 'text', text: `Error executing command: ${msg}` }],
          details: { exitCode: 1 },
        };
      }
    },
  };
}

// ─── Sandbox Execution ──────────────────────────────────────────────────────

interface SandboxOptions {
  cwd: string;
  timeout: number;
  env: Record<string, string>;
  signal?: AbortSignal;
}

interface SandboxResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
}

/** Resource limits prepended to every command: 512MB vmem, 30s CPU, 100MB files. */
const RESOURCE_LIMITS = 'ulimit -v 524288 -t 30 -f 102400 2>/dev/null; ';

function execInSandbox(command: string, opts: SandboxOptions): Promise<SandboxResult> {
  return new Promise((resolve, reject) => {
    const wrappedCommand = RESOURCE_LIMITS + command;
    const child = spawn('bash', ['-c', wrappedCommand], {
      cwd: opts.cwd,
      env: opts.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true, // Create process group for clean kill
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    child.stdout.on('data', (data: Buffer) => {
      stdout += data.toString();
    });
    child.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    const timer = setTimeout(() => {
      timedOut = true;
      // Kill the process group to ensure child processes (e.g., sleep) are also terminated
      try { process.kill(-child.pid!, 'SIGTERM'); } catch { child.kill('SIGTERM'); }
      // Give 2s for graceful shutdown, then SIGKILL
      setTimeout(() => {
        try { process.kill(-child.pid!, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
      }, 2_000);
    }, opts.timeout);

    // Respect AbortSignal
    if (opts.signal) {
      const onAbort = () => {
        child.kill('SIGTERM');
      };
      opts.signal.addEventListener('abort', onAbort, { once: true });
      child.on('close', () => {
        opts.signal?.removeEventListener('abort', onAbort);
      });
    }

    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({
        stdout,
        stderr,
        exitCode: code ?? (timedOut ? 124 : 1),
        timedOut,
      });
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}
