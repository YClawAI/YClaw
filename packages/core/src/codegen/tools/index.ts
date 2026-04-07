/**
 * YClaw-Safe Tool Set — custom tools for pi-coding-agent sessions.
 *
 * These tools replace pi's built-in tools entirely (via tools: [] + customTools).
 * Every tool enforces workspace boundaries. Write/edit/bash are safety-gated.
 *
 * Usage:
 *   const tools = createYClawTools({ workspaceRoot: '/tmp/yclaw-tasks/task-123' });
 *   const { session } = await createAgentSession({
 *     tools: [],              // Disable ALL built-in tools
 *     customTools: tools,     // Inject YClaw-safe tools
 *   });
 */

import type { ToolDefinition } from '@mariozechner/pi-coding-agent';
import { createYClawReadTool } from './read.js';
import { createYClawWriteTool } from './write.js';
import { createYClawEditTool } from './edit.js';
import { createYClawBashTool } from './bash.js';
import { createYClawGrepTool } from './grep.js';
import { createYClawLsTool } from './ls.js';
import type { YClawToolConfig, AuditLogFn } from './types.js';

export type { YClawToolConfig, AuditLogFn };

/** Allowlist of valid YClaw tool names. Rejects any unknown tool calls. */
export const YCLAW_TOOL_NAMES = new Set([
  'yclaw-read', 'yclaw-write', 'yclaw-edit',
  'yclaw-bash', 'yclaw-grep', 'yclaw-ls',
]);

/**
 * Create the full set of YClaw-safe tools for a pi-coding-agent session.
 * Returns 6 tools: yclaw-read, yclaw-write, yclaw-edit, yclaw-bash, yclaw-grep, yclaw-ls.
 */
export function createYClawTools(config: YClawToolConfig): ToolDefinition[] {
  return [
    createYClawReadTool(config),
    createYClawWriteTool(config),
    createYClawEditTool(config),
    createYClawBashTool(config),
    createYClawGrepTool(config),
    createYClawLsTool(config),
  ];
}

export {
  createYClawReadTool,
  createYClawWriteTool,
  createYClawEditTool,
  createYClawBashTool,
  createYClawGrepTool,
  createYClawLsTool,
};
