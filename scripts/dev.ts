/**
 * Local development runner for the YClaw Agent System.
 *
 * Usage: npx tsx scripts/dev.ts [agent] [task]
 *
 * Examples:
 *   npx tsx scripts/dev.ts                    # Run full system
 *   npx tsx scripts/dev.ts ember              # Run only EMBER agent (all triggers)
 *   npx tsx scripts/dev.ts ember daily_content_batch  # Run specific task once
 */

import 'dotenv/config';
import { AgentExecutor } from '../packages/core/src/agent/executor.js';
import { AgentRouter } from '../packages/core/src/agent/router.js';
import { AuditLog } from '../packages/core/src/logging/audit.js';
import { createLogger } from '../packages/core/src/logging/logger.js';
import { SelfModTools } from '../packages/core/src/self/tools.js';
import { SafetyGate } from '../packages/core/src/self/safety.js';
import { ReviewGate } from '../packages/core/src/review/reviewer.js';
import { ActionRegistryImpl } from '../packages/core/src/actions/registry.js';
import { EventBus } from '../packages/core/src/triggers/event.js';
import { SlackExecutor } from '../packages/core/src/actions/slack.js';
import { EventActionExecutor } from '../packages/core/src/actions/event.js';

const logger = createLogger('dev');

async function dev(): Promise<void> {
  const [targetAgent, targetTask] = process.argv.slice(2);

  logger.info('YClaw Agent System — Development Mode');
  if (targetAgent) logger.info(`Targeting agent: ${targetAgent}`);
  if (targetTask) logger.info(`Targeting task: ${targetTask}`);

  // Minimal infrastructure for dev
  const auditLog = new AuditLog();
  try {
    await auditLog.connect();
    logger.info('MongoDB connected');
  } catch (err) {
    logger.warn('MongoDB not available — running without persistence', { error: err });
  }

  const eventBus = new EventBus(process.env.REDIS_URL || 'redis://localhost:6379');
  const selfModTools = new SelfModTools(auditLog);
  const safetyGate = new SafetyGate();
  const reviewGate = new ReviewGate();
  await reviewGate.initialize();

  const actionRegistry = new ActionRegistryImpl();
  actionRegistry.register('slack', new SlackExecutor());
  actionRegistry.register('event', new EventActionExecutor(eventBus));

  // Log actions instead of executing them in dev mode
  const dryRunProxy = {
    register: () => {},
    execute: async (actionName: string, params: Record<string, unknown>) => {
      logger.info(`[DRY RUN] Action: ${actionName}`, params);
      return { success: true, data: { dryRun: true } };
    },
    listActions: () => [],
    getExecutor: () => undefined,
  };

  const executor = new AgentExecutor(
    auditLog,
    selfModTools,
    safetyGate,
    reviewGate,
    process.env.DRY_RUN === 'true' ? dryRunProxy as any : actionRegistry,
    eventBus,
  );

  const router = new AgentRouter();

  if (targetAgent && targetTask) {
    // Run a single agent task
    const config = router.getConfig(targetAgent);
    if (!config) {
      logger.error(`Agent not found: ${targetAgent}`);
      process.exit(1);
    }

    logger.info(`Running ${targetAgent}:${targetTask}...`);
    const result = await executor.execute(config, targetTask, 'manual');
    logger.info('Execution result:', {
      status: result.status,
      actions: result.actionsTaken.length,
      selfMods: result.selfModifications.length,
      tokens: result.tokenUsage,
    });
  } else {
    // List all agents and their triggers
    const configs = router.getAllConfigs();
    logger.info(`\nLoaded ${configs.size} agents:\n`);
    for (const [name, config] of configs) {
      const cronCount = config.triggers.filter(t => t.type === 'cron').length;
      const eventCount = config.triggers.filter(t => t.type === 'event').length;
      logger.info(
        `  ${name.padEnd(12)} [${config.department.padEnd(11)}] ` +
        `${cronCount} cron, ${eventCount} event triggers | ` +
        `${config.model.model}`
      );
    }

    if (targetAgent) {
      // Run all tasks for a specific agent
      const config = router.getConfig(targetAgent);
      if (!config) {
        logger.error(`Agent not found: ${targetAgent}`);
        process.exit(1);
      }

      logger.info(`\nRunning all cron tasks for ${targetAgent}...\n`);
      for (const trigger of config.triggers) {
        if (trigger.type === 'cron') {
          logger.info(`  Running: ${trigger.task}`);
          const result = await executor.execute(config, trigger.task, 'cron');
          logger.info(`  Result: ${result.status}`);
        }
      }
    } else {
      logger.info('\nUsage:');
      logger.info('  npx tsx scripts/dev.ts <agent> <task>  — Run specific task');
      logger.info('  npx tsx scripts/dev.ts <agent>         — Run all tasks for agent');
      logger.info('  DRY_RUN=true npx tsx scripts/dev.ts    — Dry run mode');
    }
  }

  await eventBus.close();
  await auditLog.disconnect();
}

dev().catch((err) => {
  logger.error('Dev runner failed', { error: err });
  process.exit(1);
});
