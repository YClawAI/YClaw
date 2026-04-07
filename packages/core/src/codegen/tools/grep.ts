/**
 * YClaw-safe Grep tool for pi-coding-agent.
 * Read-only workspace-restricted content search.
 */

import { Type, type Static } from '@sinclair/typebox';
import type { ToolDefinition, AgentToolResult } from '@mariozechner/pi-coding-agent';
import { resolveWithinWorkspace, WorkspaceBoundaryError } from './workspace.js';
import { spawn } from 'node:child_process';
import type { YClawToolConfig } from './types.js';

const GrepParams = Type.Object({
  pattern: Type.String({ description: 'Regex pattern to search for' }),
  path: Type.Optional(Type.String({ description: 'Directory or file to search in (relative to workspace, default: .)' })),
  include: Type.Optional(Type.String({ description: 'Glob pattern for files to include (e.g., "*.ts")' })),
});

export function createYClawGrepTool(config: YClawToolConfig): ToolDefinition {
  return {
    name: 'yclaw-grep',
    label: 'Grep',
    description: 'Search file contents with regex. Path is relative to workspace root.',
    parameters: GrepParams,
    execute: async (
      _toolCallId: string,
      params: Static<typeof GrepParams>,
      signal: AbortSignal | undefined,
      _onUpdate: unknown,
      _ctx: unknown,
    ): Promise<AgentToolResult<Record<string, unknown>>> => {
      try {
        const searchPath = params.path
          ? resolveWithinWorkspace(config.workspaceRoot, params.path)
          : config.workspaceRoot;

        const args = ['-rn', '--color=never'];
        if (params.include) {
          args.push(`--include=${params.include}`);
        }
        args.push(params.pattern, searchPath);

        const result = await runGrep(args, config.workspaceRoot, signal);

        config.auditLogger?.('yclaw-grep', params.pattern, 'success');
        return {
          content: [{ type: 'text', text: result || 'No matches found.' }],
          details: {},
        };
      } catch (err) {
        if (err instanceof WorkspaceBoundaryError) {
          config.auditLogger?.('yclaw-grep', params.pattern, 'blocked:boundary');
          return {
            content: [{ type: 'text', text: 'Error: path outside workspace boundary' }],
            details: {},
          };
        }
        const msg = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: 'text', text: `Error: ${msg}` }],
          details: {},
        };
      }
    },
  };
}

function runGrep(args: string[], cwd: string, signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('grep', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';

    child.stdout.on('data', (data: Buffer) => {
      stdout += data.toString();
      // Cap output
      if (stdout.length > 100_000) {
        child.kill('SIGTERM');
      }
    });

    if (signal) {
      const onAbort = () => child.kill('SIGTERM');
      signal.addEventListener('abort', onAbort, { once: true });
      child.on('close', () => signal.removeEventListener('abort', onAbort));
    }

    child.on('close', (code) => {
      // grep exits 1 when no matches — not an error
      if (code === 0 || code === 1) {
        resolve(stdout.slice(0, 100_000));
      } else {
        resolve(stdout || 'No matches found.');
      }
    });

    child.on('error', reject);
  });
}
