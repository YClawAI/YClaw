import type { ActionResult, ActionExecutor } from './types.js';
import type { ToolDefinition } from '../config/schema.js';
import type { EventBus } from '../triggers/event.js';
import { createLogger } from '../logging/logger.js';

const logger = createLogger('event-executor');

/**
 * Event publishing action executor.
 * Publishes events to the internal Redis EventBus for inter-agent communication.
 *
 * Actions:
 *   event:publish — Publish an event to the event bus
 *
 * Params:
 *   source  (string)  — Agent or system that emitted the event
 *   type    (string)  — Event type identifier (e.g. "asset_ready", "content_ready")
 *   payload (object)  — Arbitrary event payload
 *   correlationId (string, optional) — For tracing causal event chains
 */
export class EventActionExecutor implements ActionExecutor {
  readonly name = 'event';

  constructor(private eventBus: EventBus) {}

  // ─── Tool Definitions (colocated schemas) ─────────────────────────────────

  getToolDefinitions(): ToolDefinition[] {
    return [
      {
        name: 'event:publish',
        description: 'Publish an event to the internal event bus for inter-agent communication',
        parameters: {
          source: { type: 'string', description: 'Agent name that is emitting the event (e.g., "builder")', required: true },
          type: { type: 'string', description: 'Event type identifier (e.g., "pr_ready", "standup_report")', required: true },
          payload: {
            type: 'object',
            description: 'Event payload — arbitrary data relevant to the event type',
            required: true,
          },
          correlationId: {
            type: 'string',
            description: 'Correlation ID inherited from the triggering event. Propagate this to maintain end-to-end pipeline traceability.',
          },
        },
      },
    ];
  }

  async execute(action: string, params: Record<string, unknown>): Promise<ActionResult> {
    switch (action) {
      case 'publish':
        return this.publish(params);
      default:
        return { success: false, error: `Unknown event action: ${action}` };
    }
  }

  async healthCheck(): Promise<boolean> {
    return true;
  }

  private async publish(params: Record<string, unknown>): Promise<ActionResult> {
    const source = params.source as string | undefined;
    const type = params.type as string | undefined;
    const payload = params.payload as Record<string, unknown> | undefined;
    const correlationId = params.correlationId as string | undefined;

    if (!source || !type) {
      return { success: false, error: 'Missing required parameters: source, type' };
    }

    // LLMs often send the full namespaced type (e.g. "strategist:forge_directive")
    // because that's what appears in YAML configs. Strip the source prefix to avoid
    // double-prefixing in EventBus dispatch (which constructs "source:type").
    let eventType = type;
    if (eventType.startsWith(`${source}:`)) {
      eventType = eventType.slice(source.length + 1);
    }

    logger.info('Publishing event', { source, type: eventType, correlationId });

    try {
      await this.eventBus.publish(source, eventType, payload || {}, correlationId);
      return {
        success: true,
        data: { source, type, correlationId },
      };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.error('Failed to publish event', { error: errorMsg });
      return { success: false, error: `Failed to publish event: ${errorMsg}` };
    }
  }
}
