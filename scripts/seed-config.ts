/**
 * Seed script — validates all agent configs and prompts exist.
 *
 * Usage: npx tsx scripts/seed-config.ts
 */

import { loadAllAgentConfigs, buildOrgChart, buildEventCatalog } from '../packages/core/src/config/loader.js';
import { createLogger } from '../packages/core/src/logging/logger.js';

const logger = createLogger('seed');

function seed(): void {
  logger.info('Validating YClaw Agent System configuration...\n');

  try {
    const configs = loadAllAgentConfigs();
    logger.info(`Loaded ${configs.size} agent configs:`);

    for (const [name, config] of configs) {
      const cronCount = config.triggers.filter(t => t.type === 'cron').length;
      const eventCount = config.triggers.filter(t => t.type === 'event').length;
      logger.info(
        `  ${name.padEnd(12)} [${config.department.padEnd(11)}] ` +
        `model: ${config.model.model}, ` +
        `prompts: ${config.system_prompts.length}, ` +
        `actions: ${config.actions.length}, ` +
        `triggers: ${cronCount}c/${eventCount}e`
      );
    }

    const orgChart = buildOrgChart(configs);
    logger.info('\nOrganization Chart:');
    for (const [dept, info] of Object.entries(orgChart.departments)) {
      logger.info(`  ${dept}: ${info.agents.join(', ')} — ${info.role}`);
    }

    const events = buildEventCatalog(configs);
    logger.info(`\nEvent Catalog (${events.length} events):`);
    for (const event of events) {
      logger.info(`  ${event}`);
    }

    logger.info('\nAll configs valid.');
  } catch (err) {
    logger.error('Configuration validation failed:', { error: err });
    process.exit(1);
  }
}

seed();
