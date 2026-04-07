#!/usr/bin/env node

/**
 * YCLAW CLI — Guided setup, validation, and deployment.
 *
 * Usage:
 *   npx yclaw init [--preset <name>] [--non-interactive] [--force]
 *   npx yclaw doctor [--json]
 *   npx yclaw deploy [--dry-run] [--detach]
 *   npx yclaw destroy [--volumes] [--force]
 *   npx yclaw config validate [--config <path>] [--strict]
 */

import { Command } from 'commander';
import { registerInitCommand } from './commands/init.js';
import { registerDoctorCommand } from './commands/doctor.js';
import { registerDeployCommand } from './commands/deploy.js';
import { registerDestroyCommand } from './commands/destroy.js';
import { registerConfigCommand } from './commands/config-validate.js';
import { registerStatusCommand } from './commands/status.js';

const program = new Command();

program
  .name('yclaw')
  .description('YCLAW — Self-hosted multi-agent orchestration system')
  .version('0.1.0');

registerInitCommand(program);
registerDoctorCommand(program);
registerDeployCommand(program);
registerDestroyCommand(program);
registerConfigCommand(program);
registerStatusCommand(program);

program.parse();
