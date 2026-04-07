/**
 * YClaw-safe Read tool for pi-coding-agent.
 * Workspace-restricted file reading.
 */

import { readFile } from 'node:fs/promises';
import { Type, type Static } from '@sinclair/typebox';
import type { ToolDefinition, AgentToolResult } from '@mariozechner/pi-coding-agent';
import { resolveWithinWorkspaceReal, WorkspaceBoundaryError } from './workspace.js';
import type { YClawToolConfig } from './types.js';

const ReadParams = Type.Object({
  path: Type.String({ description: 'File path relative to workspace root' }),
  offset: Type.Optional(Type.Number({ description: 'Start line (1-indexed)' })),
  limit: Type.Optional(Type.Number({ description: 'Max lines to read' })),
});

export function createYClawReadTool(config: YClawToolConfig): ToolDefinition {
  return {
    name: 'yclaw-read',
    label: 'Read File',
    description: 'Read a file\'s contents. Path is relative to workspace root.',
    parameters: ReadParams,
    execute: async (
      _toolCallId: string,
      params: Static<typeof ReadParams>,
      _signal: AbortSignal | undefined,
      _onUpdate: unknown,
      _ctx: unknown,
    ): Promise<AgentToolResult<Record<string, unknown>>> => {
      try {
        const fullPath = await resolveWithinWorkspaceReal(config.workspaceRoot, params.path);
        let content = await readFile(fullPath, 'utf-8');

        // Apply offset/limit if provided
        if (params.offset !== undefined || params.limit !== undefined) {
          const lines = content.split('\n');
          const start = (params.offset ?? 1) - 1; // Convert to 0-indexed
          const end = params.limit !== undefined ? start + params.limit : lines.length;
          content = lines.slice(start, end).join('\n');
        }

        config.auditLogger?.('yclaw-read', params.path, 'success');
        return {
          content: [{ type: 'text', text: content }],
          details: { bytesRead: Buffer.byteLength(content, 'utf-8') },
        };
      } catch (err) {
        if (err instanceof WorkspaceBoundaryError) {
          config.auditLogger?.('yclaw-read', params.path, 'blocked:boundary');
          return {
            content: [{ type: 'text', text: 'Error: path outside workspace boundary' }],
            details: {},
          };
        }
        const msg = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: 'text', text: `Error reading file: ${msg}` }],
          details: {},
        };
      }
    },
  };
}
