import type { ActionResult, ActionExecutor, ActionRegistry } from './types.js';
import type { ToolDefinition } from '../config/schema.js';
import { createLogger } from '../logging/logger.js';

const logger = createLogger('action-registry');

// ─── Central Action Registry ────────────────────────────────────────────────
//
// Routes "prefix:action" strings to the correct ActionExecutor.
// Example: "twitter:post" -> TwitterExecutor.execute("post", params)
//
// Tool definitions are colocated with each executor via getToolDefinitions().
// The registry aggregates them for the LLM layer.
//

export class ActionRegistryImpl implements ActionRegistry {
  private executors = new Map<string, ActionExecutor>();

  register(prefix: string, executor: ActionExecutor): void {
    if (this.executors.has(prefix)) {
      logger.warn(`Overwriting existing executor for prefix "${prefix}"`);
    }
    this.executors.set(prefix, executor);
    logger.info(`Registered action executor: ${prefix} -> ${executor.name}`);
  }

  async execute(actionName: string, params: Record<string, unknown>): Promise<ActionResult> {
    const colonIndex = actionName.indexOf(':');
    if (colonIndex === -1) {
      const errorMsg = `Invalid action name "${actionName}": expected "prefix:action" format`;
      logger.error(errorMsg);
      return { success: false, error: errorMsg };
    }

    const prefix = actionName.slice(0, colonIndex);
    const action = actionName.slice(colonIndex + 1);

    const executor = this.executors.get(prefix);
    if (!executor) {
      const available = Array.from(this.executors.keys()).join(', ');
      const errorMsg = `No executor registered for prefix "${prefix}". Available: [${available}]`;
      logger.error(errorMsg);
      return { success: false, error: errorMsg };
    }

    logger.info(`Executing action: ${actionName}`, { prefix, action, executor: executor.name });

    try {
      const result = await executor.execute(action, params);
      if (result.success) {
        logger.info(`Action "${actionName}" completed successfully`, { data: result.data });
      } else {
        logger.warn(`Action "${actionName}" returned failure`, { error: result.error });
      }
      return result;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.error(`Action "${actionName}" threw an exception: ${errorMsg}`);
      return { success: false, error: errorMsg };
    }
  }

  listActions(): string[] {
    return Array.from(this.executors.keys()).map(prefix => `${prefix}:*`);
  }

  getExecutor(prefix: string): ActionExecutor | undefined {
    return this.executors.get(prefix);
  }

  hasExecutor(prefix: string): boolean {
    return this.executors.has(prefix);
  }

  unregister(prefix: string): boolean {
    const removed = this.executors.delete(prefix);
    if (removed) {
      logger.info(`Unregistered action executor: ${prefix}`);
    }
    return removed;
  }

  /**
   * Aggregate tool definitions from all registered executors.
   * Each executor owns its own schema definitions via getToolDefinitions().
   */
  getAllToolDefinitions(): ToolDefinition[] {
    const definitions: ToolDefinition[] = [];
    for (const executor of this.executors.values()) {
      definitions.push(...executor.getToolDefinitions());
    }
    return definitions;
  }
}
