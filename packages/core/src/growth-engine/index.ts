import { createLogger } from '../logging/logger.js';
import type { EventBus } from '../triggers/event.js';
import type { GrowthEngineConfig } from './types.js';
import { ExperimentEngine } from './engine.js';
import { ColdEmailChannel } from './channels/cold-email.js';
import { TwitterChannel } from './channels/twitter.js';
import { LandingPageChannel } from './channels/landing-page.js';

export type { GrowthEngineConfig } from './types.js';
export type {
  Template,
  ChannelConfig,
  ExperimentLoop,
  ExperimentResult,
  ComplianceResult,
  CrossChannelInsight,
  ScoreResult,
  DeployResult,
  ChannelMetrics,
} from './types.js';
export { ExperimentEngine } from './engine.js';
export { ComplianceChecker } from './compliance.js';
export { Mutator } from './mutator.js';
export { Scorer } from './scorer.js';
export { Propagator } from './propagator.js';
export { BaseChannel } from './channels/base-channel.js';
export { ColdEmailChannel } from './channels/cold-email.js';
export { TwitterChannel } from './channels/twitter.js';
export { LandingPageChannel } from './channels/landing-page.js';

// ─── Module Registration ──────────────────────────────────────────────────────

const log = createLogger('growth-engine');

export interface GrowthEngineModuleConfig {
  /** AgentHub base URL */
  agentHubUrl: string;
  /** API key for the growth engine agent */
  apiKey: string;
  /** Agent ID (default: 'growth-engine') */
  agentId?: string;
  /** EventBus instance */
  eventBus: EventBus;
  /** Path to config directory containing baseline.md and channels/ */
  configDir: string;
  /** Number of initial experiments per channel requiring human approval (default: 5) */
  humanApprovalCount?: number;
}

/**
 * Register the growth engine module with the YClaw agent runtime.
 *
 * Creates the experiment engine, registers all channel adapters,
 * and starts the experiment loops.
 *
 * If AgentHub is unreachable, logs a warning and returns inert handles.
 */
export function registerGrowthEngine(config: GrowthEngineModuleConfig): {
  engine: ExperimentEngine;
  stop: () => void;
} {
  const {
    agentHubUrl,
    apiKey,
    agentId = 'growth-engine',
    eventBus,
    configDir,
    humanApprovalCount = 5,
  } = config;

  const engineConfig: GrowthEngineConfig = {
    agentHubUrl,
    apiKey,
    agentId,
    humanApprovalCount,
  };

  const engine = new ExperimentEngine(engineConfig, eventBus);

  // Register channel adapters
  engine.registerChannel(new ColdEmailChannel());
  engine.registerChannel(new TwitterChannel());
  engine.registerChannel(new LandingPageChannel());

  // Start the engine (non-blocking — loops run via setTimeout)
  void engine.start(configDir).catch((err) => {
    log.error('Growth engine failed to start', { error: (err as Error).message });
  });

  log.info('Growth engine registered', {
    agentHubUrl,
    agentId,
    channels: ['cold-email', 'twitter', 'landing-page'],
    humanApprovalCount,
  });

  return {
    engine,
    stop: () => engine.stopAll(),
  };
}
