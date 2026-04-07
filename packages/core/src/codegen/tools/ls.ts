/**
 * YClaw-safe Ls tool for pi-coding-agent.
 * Read-only workspace-restricted directory listing.
 */

import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { Type, type Static } from '@sinclair/typebox';
import type { ToolDefinition, AgentToolResult } from '@mariozechner/pi-coding-agent';
import { resolveWithinWorkspace, WorkspaceBoundaryError } from './workspace.js';
import type { YClawToolConfig } from './types.js';

const LsParams = Type.Object({
  path: Type.Optional(Type.String({ description: 'Directory path relative to workspace root (default: .)' })),
});

export function createYClawLsTool(config: YClawToolConfig): ToolDefinition {
  return {
    name: 'yclaw-ls',
    label: 'List Directory',
    description: 'List directory contents. Path is relative to workspace root.',
    parameters: LsParams,
    execute: async (
      _toolCallId: string,
      params: Static<typeof LsParams>,
      _signal: AbortSignal | undefined,
      _onUpdate: unknown,
      _ctx: unknown,
    ): Promise<AgentToolResult<Record<string, unknown>>> => {
      try {
        const dirPath = params.path
          ? resolveWithinWorkspace(config.workspaceRoot, params.path)
          : config.workspaceRoot;

        const entries = await readdir(dirPath, { withFileTypes: true });
        const lines: string[] = [];

        for (const entry of entries) {
          const entryPath = join(dirPath, entry.name);
          try {
            const s = await stat(entryPath);
            const type = entry.isDirectory() ? 'd' : entry.isSymbolicLink() ? 'l' : '-';
            const size = entry.isDirectory() ? '' : ` (${formatBytes(s.size)})`;
            lines.push(`${type} ${entry.name}${size}`);
          } catch {
            lines.push(`? ${entry.name}`);
          }
        }

        config.auditLogger?.('yclaw-ls', params.path ?? '.', 'success');
        return {
          content: [{ type: 'text', text: lines.join('\n') || '(empty directory)' }],
          details: { entryCount: entries.length },
        };
      } catch (err) {
        if (err instanceof WorkspaceBoundaryError) {
          config.auditLogger?.('yclaw-ls', params.path ?? '.', 'blocked:boundary');
          return {
            content: [{ type: 'text', text: 'Error: path outside workspace boundary' }],
            details: {},
          };
        }
        const msg = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: 'text', text: `Error listing directory: ${msg}` }],
          details: {},
        };
      }
    },
  };
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
