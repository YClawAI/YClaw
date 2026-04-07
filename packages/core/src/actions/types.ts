import type { ToolDefinition } from '../config/schema.js';

export interface ActionResult {
  success: boolean;
  data?: Record<string, unknown>;
  error?: string;
}

export interface ActionExecutor {
  readonly name: string;
  execute(action: string, params: Record<string, unknown>): Promise<ActionResult>;
  healthCheck(): Promise<boolean>;
  getToolDefinitions(): ToolDefinition[];
}

export interface ActionRegistry {
  register(prefix: string, executor: ActionExecutor): void;
  execute(actionName: string, params: Record<string, unknown>): Promise<ActionResult>;
  listActions(): string[];
  getExecutor(prefix: string): ActionExecutor | undefined;
  getAllToolDefinitions(): ToolDefinition[];
}
