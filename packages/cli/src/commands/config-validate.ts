import { resolve } from 'node:path';
import type { Command } from 'commander';
import { loadConfig } from '../utils/load-config.js';
import { handleError } from '../utils/errors.js';
import * as output from '../utils/output.js';

export function registerConfigCommand(program: Command): void {
  const configCmd = program
    .command('config')
    .description('Configuration management');

  configCmd
    .command('validate')
    .description('Validate yclaw.config.yaml against the schema')
    .option('--config <path>', 'Path to config directory', '.')
    .option('--strict', 'Fail on warnings, not just errors')
    .action(async (opts) => {
      try {
        const dir = resolve(opts.config ?? '.');

        const config = await loadConfig(dir);

        output.success('yclaw.config.yaml is valid');

        // Strict mode: warn about potential issues
        if (opts.strict) {
          const warnings: string[] = [];

          if (!config.deployment) {
            warnings.push('No deployment target specified');
          }

          const enabledChannels = Object.entries(config.channels)
            .filter(([, v]) => v && 'enabled' in v && v.enabled);
          if (enabledChannels.length === 0) {
            warnings.push('No communication channels enabled');
          }

          if (warnings.length > 0) {
            for (const w of warnings) {
              output.warn(w);
            }
            process.exit(1);
          }
        }

        process.exit(0);
      } catch (err) {
        handleError(err);
      }
    });
}
