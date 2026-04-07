import type { EventBus } from '../triggers/event.js';
import { createLogger } from '../logging/logger.js';
import { AgentHubClient } from '../agenthub/client.js';
import type { ExplorationDirective, ExplorationTask } from '../agenthub/types.js';
import { ExplorationDispatcher } from './exploration-dispatcher.js';
import { ExplorationReviewer } from './exploration-reviewer.js';
import { ExplorationPoller, POLL_INTERVAL_MS } from './poller.js';

export type { ExplorationDirective, ExplorationTask };
export { AgentHubClient } from '../agenthub/client.js';
export { AgentHubPromoter } from '../agenthub/promoter.js';
export { ExplorationDispatcher } from './exploration-dispatcher.js';
export { ExplorationWorker } from './exploration-worker.js';
export { ExplorationReviewer } from './exploration-reviewer.js';
export { ExplorationPoller } from './poller.js';

// ─── Module Registration ───────────────────────────────────────────────────

const log = createLogger('exploration');

export interface ExplorationModuleConfig {
  /** AgentHub base URL */
  agentHubUrl: string;
  /** API key for the dispatcher agent (used for scaffold push + message board) */
  dispatcherApiKey: string;
  /** Agent ID for the dispatcher (e.g. "builder") */
  dispatcherAgentId: string;
  /** Map of worker IDs to their API keys */
  workerApiKeys: Record<string, string>;
  /** GitHub token for cloning target repos and opening promotion PRs */
  githubToken: string;
  /** EventBus instance for subscribing to exploration directives */
  eventBus: EventBus;
}

/**
 * Register the exploration module with the YClaw agent runtime.
 *
 * Subscribes to NEW events only. Does NOT modify any existing module registrations.
 * If AgentHub is down or unreachable, the module logs a warning and becomes inert.
 */
export function registerExplorationModule(config: ExplorationModuleConfig): {
  dispatcher: ExplorationDispatcher;
  poller: ExplorationPoller;
  stop: () => void;
} {
  const {
    agentHubUrl,
    dispatcherApiKey,
    dispatcherAgentId,
    workerApiKeys,
    githubToken,
    eventBus,
  } = config;

  // Create dispatcher client
  const dispatcherClient = new AgentHubClient({
    baseUrl: agentHubUrl,
    apiKey: dispatcherApiKey,
    agentId: dispatcherAgentId,
  });

  // Create per-worker clients
  const workerClients = new Map<string, AgentHubClient>();
  for (const [workerId, apiKey] of Object.entries(workerApiKeys)) {
    workerClients.set(workerId, new AgentHubClient({
      baseUrl: agentHubUrl,
      apiKey,
      agentId: workerId,
    }));
  }

  // Create components
  const dispatcher = new ExplorationDispatcher(dispatcherClient, workerClients, githubToken);
  const reviewer = new ExplorationReviewer(dispatcherClient, githubToken);
  const poller = new ExplorationPoller(dispatcher, reviewer);

  // F2: Subscribe to correctly-named event (underscore, matching strategist:${agent}_directive pattern)
  eventBus.subscribe('strategist:exploration_directive', async (event) => {
    const directive = event.payload as unknown as ExplorationDirective;
    if (!directive.taskId || !directive.description) {
      log.warn('Ignoring malformed exploration_directive', {
        keys: Object.keys(event.payload ?? {}),
      });
      return;
    }

    log.info('Received exploration directive', {
      taskId: directive.taskId,
      description: directive.description.slice(0, 80),
    });

    try {
      await dispatcher.handleDirective(directive);
    } catch (err) {
      log.error('Failed to handle exploration directive', {
        taskId: directive.taskId,
        error: (err as Error).message,
        stack: (err as Error).stack,
      });
    }
  });

  // Start polling
  poller.start(POLL_INTERVAL_MS);

  log.info('Exploration module registered — listening for exploration_directive events', {
    agentHubUrl,
    dispatcherAgentId,
    workers: Object.keys(workerApiKeys),
  });

  return {
    dispatcher,
    poller,
    stop: () => poller.stop(),
  };
}
