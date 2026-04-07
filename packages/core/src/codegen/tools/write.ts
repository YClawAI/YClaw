/**
 * YClaw-safe Write tool for pi-coding-agent.
 * Workspace-restricted + safety-gated file writing.
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { Type, type Static } from '@sinclair/typebox';
import type { ToolDefinition, AgentToolResult } from '@mariozechner/pi-coding-agent';
import { resolveWithinWorkspace, resolveWithinWorkspaceReal, WorkspaceBoundaryError } from './workspace.js';
import type { YClawToolConfig } from './types.js';

const WriteParams = Type.Object({
  path: Type.String({ description: 'File path relative to workspace root' }),
  content: Type.String({ description: 'File content to write' }),
});

export function createYClawWriteTool(config: YClawToolConfig): ToolDefinition {
  return {
    name: 'yclaw-write',
    label: 'Write File',
    description: 'Write content to a file. Creates parent directories if needed. Path is relative to workspace root.',
    parameters: WriteParams,
    execute: async (
      _toolCallId: string,
      params: Static<typeof WriteParams>,
      _signal: AbortSignal | undefined,
      _onUpdate: unknown,
      _ctx: unknown,
    ): Promise<AgentToolResult<Record<string, unknown>>> => {
      try {
        // Lexical boundary check first (fast path)
        const fullPath = resolveWithinWorkspace(config.workspaceRoot, params.path);

        // Create parent dirs, then verify the resolved parent is still inside
        // workspace after symlink resolution (prevents symlink-parent escape:
        // workspace/link -> /etc, then writing link/file).
        await mkdir(dirname(fullPath), { recursive: true });
        await resolveWithinWorkspaceReal(config.workspaceRoot, dirname(fullPath));

        await writeFile(fullPath, params.content, 'utf-8');

        const bytes = Buffer.byteLength(params.content, 'utf-8');
        config.auditLogger?.('yclaw-write', params.path, 'success');
        return {
          content: [{ type: 'text', text: `Wrote ${bytes} bytes to ${params.path}` }],
          details: { bytesWritten: bytes },
        };
      } catch (err) {
        if (err instanceof WorkspaceBoundaryError) {
          config.auditLogger?.('yclaw-write', params.path, 'blocked:boundary');
          return {
            content: [{ type: 'text', text: 'Error: path outside workspace boundary' }],
            details: {},
          };
        }
        const msg = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: 'text', text: `Error writing file: ${msg}` }],
          details: {},
        };
      }
    },
  };
}
