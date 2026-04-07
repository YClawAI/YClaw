import 'dotenv/config';
import { createLogger } from './logging/logger.js';
import { InfrastructureFactory } from './infrastructure/InfrastructureFactory.js';
import { initServices } from './bootstrap/services.js';
import { initActions } from './bootstrap/actions.js';
import { initAgents } from './bootstrap/agents.js';
import { initRoutes } from './bootstrap/routes.js';

const logger = createLogger('main');

async function main(): Promise<void> {
  // ─── Phase 0: Infrastructure Layer ──────────────────────────────────────
  // Load config and create infrastructure adapters. This establishes the
  // abstract infrastructure layer. The existing bootstrap pipeline (services,
  // actions, agents, routes) continues to work alongside it.
  const config = await InfrastructureFactory.loadConfig();
  const infrastructure = await InfrastructureFactory.create(config);
  logger.info('Infrastructure layer initialized', {
    channels: [...infrastructure.channels.keys()],
  });

  // ─── Phases 1-4: Existing Bootstrap Pipeline ───────────────────────────
  // ServiceContext is wired from infrastructure adapters where possible.
  // Modules that haven't been migrated yet continue using ServiceContext.
  const services = await initServices(infrastructure, config);
  const actions = await initActions(services);
  const agents = await initAgents(services, actions);
  const { webhookServer, telegramHandler } = await initRoutes(services, actions, agents);

  let shutdownInProgress = false;
  const shutdown = async (signal: string) => {
    if (shutdownInProgress) return;
    shutdownInProgress = true;
    logger.info(`Received ${signal}, beginning graceful shutdown...`);

    agents.cronManager.stopAll();
    agents.explorationStop?.();
    agents.growthEngineStop?.();
    agents.router.beginShutdown();
    logger.info('Phase 1: Stopped accepting new work');

    const drainPromises: Promise<void>[] = [];
    drainPromises.push(agents.router.drainExecutions(15_000));
    await Promise.allSettled(drainPromises);
    logger.info('Phase 2: Drained in-flight executions');

    await telegramHandler.stop();
    await webhookServer.stop();
    await services.eventBus.close();
    if (services.fleetGuard) await services.fleetGuard.shutdown();
    await services.auditLog.disconnect();
    // Disconnect infrastructure adapters
    await infrastructure.stateStore.disconnect();
    await infrastructure.eventBus.disconnect();
    for (const channel of infrastructure.channels.values()) {
      await channel.disconnect();
    }
    logger.info('Phase 3: Closed connections');
    logger.info(`Graceful shutdown complete (${signal})`);
    process.exit(0);
  };

  const forceShutdown = (signal: string) => {
    shutdown(signal).catch(err => {
      logger.error('Error during shutdown', { error: err });
      process.exit(1);
    });
    setTimeout(() => {
      logger.error('Forced exit — shutdown did not complete in 28s');
      process.exit(1);
    }, 28_000).unref();
  };

  process.on('SIGTERM', () => forceShutdown('SIGTERM'));
  process.on('SIGINT', () => forceShutdown('SIGINT'));

  logger.info('YClaw Agent System is running');
  logger.info(`  Webhook server: http://localhost:${process.env.PORT || 3000}`);
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? err.stack : undefined;
  logger.error('Fatal error during startup', { error: message, stack });
  process.exit(1);
});
