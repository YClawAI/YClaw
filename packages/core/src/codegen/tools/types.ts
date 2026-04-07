/**
 * Shared types for YClaw-safe tool implementations.
 */

/**
 * Configuration for creating YClaw-safe tools.
 * Passed to each tool factory function.
 */
export interface YClawToolConfig {
  /** Absolute path to the workspace root. All file operations are confined here. */
  workspaceRoot: string;
  /** Optional audit logger callback. Called for every tool execution. */
  auditLogger?: AuditLogFn;
}

/**
 * Audit log function signature.
 * @param toolName - Name of the tool (read, write, edit, bash, grep, ls)
 * @param target - File path or command being operated on
 * @param outcome - Result: 'success', 'error', 'blocked:boundary', 'blocked:<reason>'
 */
export type AuditLogFn = (toolName: string, target: string, outcome: string) => void;

/** Alias for YClawToolConfig — used in some contexts as YClawToolContext */
export type YClawToolContext = YClawToolConfig;
