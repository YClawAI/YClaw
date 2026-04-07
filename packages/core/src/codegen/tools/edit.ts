/**
 * YClaw-safe Edit tool for pi-coding-agent.
 * Workspace-restricted + safety-gated file editing.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { Type, type Static } from '@sinclair/typebox';
import type { ToolDefinition, AgentToolResult } from '@mariozechner/pi-coding-agent';
import { resolveWithinWorkspaceReal, WorkspaceBoundaryError } from './workspace.js';
import type { YClawToolConfig } from './types.js';

const EditParams = Type.Object({
  path: Type.String({ description: 'File path relative to workspace root' }),
  old_string: Type.String({ description: 'Exact string to find and replace' }),
  new_string: Type.String({ description: 'Replacement string' }),
});

export function createYClawEditTool(config: YClawToolConfig): ToolDefinition {
  return {
    name: 'yclaw-edit',
    label: 'Edit File',
    description: 'Replace an exact string match in a file. Path is relative to workspace root.',
    parameters: EditParams,
    execute: async (
      _toolCallId: string,
      params: Static<typeof EditParams>,
      _signal: AbortSignal | undefined,
      _onUpdate: unknown,
      _ctx: unknown,
    ): Promise<AgentToolResult<Record<string, unknown>>> => {
      try {
        const fullPath = await resolveWithinWorkspaceReal(config.workspaceRoot, params.path);

        const content = await readFile(fullPath, 'utf-8');

        if (!content.includes(params.old_string)) {
          return {
            content: [{ type: 'text', text: `Error: old_string not found in ${params.path}` }],
            details: {},
          };
        }

        // Check uniqueness — edit should be unambiguous
        const occurrences = content.split(params.old_string).length - 1;
        if (occurrences > 1) {
          return {
            content: [{
              type: 'text',
              text: `Error: old_string found ${occurrences} times in ${params.path}. ` +
                'Provide more context to make the match unique.',
            }],
            details: {},
          };
        }

        const updated = content.replace(params.old_string, params.new_string);
        await writeFile(fullPath, updated, 'utf-8');

        config.auditLogger?.('yclaw-edit', params.path, 'success');
        return {
          content: [{ type: 'text', text: `Edited ${params.path}` }],
          details: { path: params.path },
        };
      } catch (err) {
        if (err instanceof WorkspaceBoundaryError) {
          config.auditLogger?.('yclaw-edit', params.path, 'blocked:boundary');
          return {
            content: [{ type: 'text', text: 'Error: path outside workspace boundary' }],
            details: {},
          };
        }
        const msg = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: 'text', text: `Error editing file: ${msg}` }],
          details: {},
        };
      }
    },
  };
}
