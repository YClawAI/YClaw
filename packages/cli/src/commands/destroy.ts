import type { Command } from 'commander';
import { confirm } from '@inquirer/prompts';
import { loadConfig } from '../utils/load-config.js';
import { handleError, CliError } from '../utils/errors.js';
import { DockerComposeExecutor } from '../deploy/docker-compose.js';
import { ManualExecutor } from '../deploy/manual.js';
import type { DeploymentExecutor } from '../types.js';
import * as output from '../utils/output.js';

const EXECUTORS: DeploymentExecutor[] = [
  new DockerComposeExecutor(),
  new ManualExecutor(),
];

export function registerDestroyCommand(program: Command): void {
  program
    .command('destroy')
    .description('Tear down YCLAW infrastructure')
    .option('--volumes', 'Also remove persistent data volumes')
    .option('--force', 'Skip confirmation prompt')
    .action(async (opts) => {
      try {
        const config = await loadConfig();

        const executor = EXECUTORS.find(e => e.canHandle(config));
        if (!executor) {
          throw new CliError(
            'No deployment executor found',
            `deployment.target: ${config.deployment?.target ?? 'not set'}`,
            'Run: yclaw init --force  to regenerate config',
          );
        }

        if (!opts.force) {
          const destroyMsg = opts.volumes
            ? 'This will destroy all YCLAW containers AND persistent data volumes (MongoDB, Redis, PostgreSQL data).'
            : 'This will stop and remove all YCLAW containers. Persistent data volumes will be preserved.';
          output.warn(destroyMsg);

          if (process.stdin.isTTY) {
            const proceed = await confirm({
              message: 'Are you sure?',
              default: false,
            });
            if (!proceed) {
              output.info('Cancelled.');
              process.exit(130);
            }
          } else {
            throw new CliError(
              'Confirmation required',
              'Cannot confirm in non-TTY mode',
              'Use: yclaw destroy --force',
            );
          }
        }

        await executor.destroy(config, { volumes: opts.volumes === true });
        process.exit(0);
      } catch (err) {
        handleError(err);
      }
    });
}
