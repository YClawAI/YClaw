import type { AgentConfig, ModelConfig, Trigger } from '../config/schema.js';
import { loadAllAgentConfigs } from '../config/loader.js';
import { createLogger } from '../logging/logger.js';

const logger = createLogger('router');

export interface RouteMatch {
  agent: AgentConfig;
  trigger: Trigger;
  taskName: string;
}

export class AgentRouter {
  private configs: Map<string, AgentConfig>;
  private inFlightExecutions = new Set<string>();
  private shuttingDown = false;

  constructor() {
    this.configs = loadAllAgentConfigs();
    logger.info(`Loaded ${this.configs.size} agent configs`);
  }

  reload(): void {
    this.configs = loadAllAgentConfigs();
    logger.info(`Reloaded ${this.configs.size} agent configs`);
  }

  trackExecution(executionId: string): void {
    this.inFlightExecutions.add(executionId);
  }

  untrackExecution(executionId: string): void {
    this.inFlightExecutions.delete(executionId);
  }

  get activeExecutionCount(): number {
    return this.inFlightExecutions.size;
  }

  beginShutdown(): void {
    this.shuttingDown = true;
  }

  get isShuttingDown(): boolean {
    return this.shuttingDown;
  }

  async drainExecutions(timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (this.inFlightExecutions.size > 0 && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    if (this.inFlightExecutions.size > 0) {
      logger.warn(`Drain timeout: ${this.inFlightExecutions.size} executions still in-flight`);
    }
  }

  getConfig(agentName: string): AgentConfig | undefined {
    return this.configs.get(agentName);
  }

  getAllConfigs(): Map<string, AgentConfig> {
    return this.configs;
  }

  routeCron(agentName: string, taskName: string): RouteMatch | null {
    const config = this.configs.get(agentName);
    if (!config) {
      logger.warn(`No config found for agent: ${agentName}`);
      return null;
    }

    const trigger = config.triggers.find(
      t => t.type === 'cron' && t.task === taskName
    );
    if (!trigger) {
      logger.warn(`No cron trigger "${taskName}" for agent: ${agentName}`);
      return null;
    }

    return { agent: config, trigger, taskName };
  }

  routeEvent(eventSource: string, eventType: string): RouteMatch[] {
    const eventKey = `${eventSource}:${eventType}`;
    const matches: RouteMatch[] = [];

    for (const [, config] of this.configs) {
      if (config.event_subscriptions.includes(eventKey)) {
        const triggers = config.triggers.filter(
          t => t.type === 'event' && t.event === eventKey
        );
        for (const trigger of triggers) {
          matches.push({
            agent: config,
            trigger,
            taskName: trigger.task,
          });
        }
      }
    }

    return matches;
  }

  routeWebhook(path: string): RouteMatch | null {
    for (const [, config] of this.configs) {
      const trigger = config.triggers.find(
        t => t.type === 'webhook' && t.path === path
      );
      if (trigger) {
        return { agent: config, trigger, taskName: trigger.task };
      }
    }
    return null;
  }

  routeManual(agentName: string, taskName: string): RouteMatch | null {
    const config = this.configs.get(agentName);
    if (!config) return null;

    return {
      agent: config,
      trigger: { type: 'manual', task: taskName },
      taskName,
    };
  }

  getAllCronTriggers(): Array<{ agent: string; task: string; schedule: string; model?: ModelConfig; prompts?: string[] }> {
    const triggers: Array<{ agent: string; task: string; schedule: string; model?: ModelConfig; prompts?: string[] }> = [];

    for (const [name, config] of this.configs) {
      for (const trigger of config.triggers) {
        if (trigger.type === 'cron') {
          triggers.push({
            agent: name,
            task: trigger.task,
            schedule: trigger.schedule,
            model: trigger.model,
            prompts: trigger.prompts,
          });
        }
      }
    }

    return triggers;
  }

  getAllEventSubscriptions(): Map<string, string[]> {
    const subs = new Map<string, string[]>();

    for (const [name, config] of this.configs) {
      for (const event of config.event_subscriptions) {
        if (!subs.has(event)) subs.set(event, []);
        subs.get(event)!.push(name);
      }
    }

    return subs;
  }

  getAllWebhookRoutes(): Array<{ path: string; agent: string; task: string }> {
    const routes: Array<{ path: string; agent: string; task: string }> = [];

    for (const [name, config] of this.configs) {
      for (const trigger of config.triggers) {
        if (trigger.type === 'webhook') {
          routes.push({
            path: trigger.path,
            agent: name,
            task: trigger.task,
          });
        }
      }
    }

    return routes;
  }
}
