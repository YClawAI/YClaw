/**
 * CodingExecutorRouter — Selects CLI or Pi executor per-task.
 *
 * Keeps executor selection logic out of the Worker so the Worker stays
 * focused on task lifecycle. The router inspects task hints and config
 * to return the right executor.
 *
 * Selection rules (in order):
 *   1. PI_CODING_AGENT_ENABLED + (task.executorHint === 'pi' OR EXECUTOR_TYPE=pi) → PiExecutor
 *   2. task.executorHint === 'cli' → SpawnCliExecutor
 *   3. Fallback → SpawnCliExecutor
 */

import { createLogger } from '../../logging/logger.js';
import { SpawnCliExecutor } from './spawn-cli-executor.js';
import { PiCodingExecutor, type PiExecutorConfig } from './pi-executor.js';
import type { CodingExecutor, ExecutorHint } from './types.js';
import type { BuilderTask } from '../../builder/types.js';
import type { AgentExecutor } from '../../agent/executor.js';
import type { AgentConfig, ExecutorConfig } from '../../config/schema.js';

const logger = createLogger('executor-router');

export interface ExecutorRouterConfig {
  /** Resolved executor config from agent YAML (or undefined for CLI-only). */
  executors?: ExecutorConfig;
  /** EXECUTOR_TYPE env override: 'cli' | 'pi' | 'auto'. Default: 'cli'. */
  executorTypeEnv?: string;
  /** Pi executor config. Only used when PI_CODING_AGENT_ENABLED=true. */
  piConfig?: PiExecutorConfig;
}

export class CodingExecutorRouter {
  private readonly pi: PiCodingExecutor | null;
  private readonly cli: SpawnCliExecutor;
  private readonly cfg: ExecutorRouterConfig;

  constructor(
    cfg: ExecutorRouterConfig,
    agentExecutor: AgentExecutor,
    builderConfig: AgentConfig,
  ) {
    this.cfg = cfg;

    // Build CLI executor (always available)
    this.cli = new SpawnCliExecutor(agentExecutor, builderConfig);

    // Build Pi executor if feature flag is enabled
    const piEnabled = process.env.PI_CODING_AGENT_ENABLED === 'true';
    if (piEnabled && cfg.piConfig) {
      this.pi = new PiCodingExecutor(cfg.piConfig);
      logger.info('Pi executor enabled');
    } else {
      this.pi = null;
      if (!piEnabled) {
        logger.info('Pi executor disabled (PI_CODING_AGENT_ENABLED != true)');
      }
    }
  }

  /**
   * Select the right executor for a given task.
   *
   * Selection priority:
   *   1. Explicit hint='cli' → CLI
   *   2. Pi enabled and available → Pi (PRIMARY for all tasks)
   *   3. Fallback → CLI
   */
  select(task: Pick<BuilderTask, 'executorHint' | 'sessionId' | 'threadId'>): CodingExecutor {
    const hint = task.executorHint as ExecutorHint | undefined;

    // Explicit CLI override always wins
    if (hint === 'cli') {
      return this.cli;
    }

    // Pi executor: PRIMARY choice when enabled and available
    if (process.env.PI_CODING_AGENT_ENABLED === 'true' && this.pi) {
      return this.pi;
    }

    return this.cli;
  }

  /** Returns the CLI executor. */
  getCli(): SpawnCliExecutor {
    return this.cli;
  }

  /** Returns the Pi executor if available (for health checks / startup sweep). */
  getPi(): PiCodingExecutor | null {
    return this.pi;
  }
}
