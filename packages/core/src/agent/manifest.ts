import { join } from 'node:path';
import type { AgentConfig, AgentManifest, ExecutionRecord, OrgChart } from '../config/schema.js';
import { getRootDir, buildOrgChart, buildEventCatalog, loadAllAgentConfigs } from '../config/loader.js';
import type { AuditLog } from '../logging/audit.js';

const RUNTIME_PATHS = {
  executor: '/packages/core/src/agent/executor.ts',
  llmLayer: '/packages/core/src/llm/',
  reviewGate: '/packages/core/src/review/reviewer.ts',
  configLoader: '/packages/core/src/config/loader.ts',
  eventBus: '/packages/core/src/triggers/event.ts',
};

const ACTION_EXECUTOR_PATHS: Record<string, string> = {
  twitter: '/packages/core/src/actions/twitter.ts',
  telegram: '/packages/core/src/actions/telegram.ts',

  slack: '/packages/core/src/actions/slack.ts',
  github: '/packages/core/src/actions/github.ts',
  email: '/packages/core/src/actions/email.ts',
  event: '/packages/core/src/actions/event.ts',
};

export class ManifestBuilder {
  private orgChart: OrgChart | null = null;
  private eventCatalog: string[] | null = null;

  constructor(private auditLog: AuditLog) {}

  async build(config: AgentConfig): Promise<AgentManifest> {
    // Lazy-load org chart
    if (!this.orgChart) {
      const allConfigs = loadAllAgentConfigs();
      this.orgChart = buildOrgChart(allConfigs);
      this.eventCatalog = buildEventCatalog(allConfigs);
    }

    const history = await this.buildHistory(config.name);
    const actionExecutors = this.resolveActionExecutors(config.actions);

    return {
      _self: {
        name: config.name,
        department: config.department,
        description: config.description,
        model: config.model,
        configPath: join(
          '/departments',
          config.department,
          `${config.name}.yaml`
        ),
        promptsLoaded: config.system_prompts.map(p => ({
          path: `/prompts/${p}`,
          tokens: undefined,
        })),
        availableActions: config.actions,
        triggers: config.triggers,
      },
      _organization: {
        departments: this.orgChart!.departments,
        eventBus: {
          mySubscriptions: config.event_subscriptions,
          myPublications: config.event_publications,
          allEvents: this.eventCatalog!,
        },
      },
      _history: history,
      _runtime: {
        executor: RUNTIME_PATHS.executor,
        llmLayer: RUNTIME_PATHS.llmLayer,
        reviewGate: RUNTIME_PATHS.reviewGate,
        actionExecutors,
        configLoader: RUNTIME_PATHS.configLoader,
        eventBus: RUNTIME_PATHS.eventBus,
      },
    };
  }

  private async buildHistory(agentName: string): Promise<AgentManifest['_history']> {
    let recentExecutions: ExecutionRecord[] = [];
    let successRate = 100;
    let mostCommonFlag: string | undefined;
    let bestPerformingContentType: string | undefined;
    let worstPerformingContentType: string | undefined;

    try {
      recentExecutions = await this.auditLog.getAgentHistory(agentName, 10);
      const stats = await this.auditLog.getAgentStats(agentName);
      successRate = stats.successRate;
      mostCommonFlag = stats.mostCommonFlag;
      bestPerformingContentType = stats.bestPerformingContentType;
      worstPerformingContentType = stats.worstPerformingContentType;
    } catch {
      // First execution or DB unavailable — empty history is fine
    }

    return {
      recentExecutions,
      successRate,
      mostCommonFlag,
      bestPerformingContentType,
      worstPerformingContentType,
    };
  }

  private resolveActionExecutors(actions: string[]): Record<string, string> {
    const executors: Record<string, string> = {};
    const prefixes = new Set(actions.map(a => a.split(':')[0]));
    for (const prefix of prefixes) {
      if (ACTION_EXECUTOR_PATHS[prefix]) {
        executors[prefix] = ACTION_EXECUTOR_PATHS[prefix];
      }
    }
    return executors;
  }

  invalidateCache(): void {
    this.orgChart = null;
    this.eventCatalog = null;
  }
}
