import { resolve } from 'node:path';
import type { Command } from 'commander';
import { runWizard, runNonInteractive } from '../wizard/runner.js';
import { generateConfigYaml } from '../generators/config-yaml.js';
import { generateEnvFile } from '../generators/env-file.js';
import { safeWrite } from '../utils/fs-safe-write.js';
import { handleError, CliError } from '../utils/errors.js';
import * as output from '../utils/output.js';

export function registerInitCommand(program: Command): void {
  program
    .command('init')
    .description('Guided setup wizard — generates yclaw.config.yaml + .env')
    .option(
      '--preset <name>',
      'Use a preset: local-demo, small-team, aws-production',
    )
    .option('--non-interactive', 'Skip interactive prompts (requires --preset)')
    .option('--output-dir <path>', 'Output directory for generated files', '.')
    .option('--force', 'Overwrite existing files without prompting')
    .action(async (opts) => {
      try {
        const outputDir = resolve(opts.outputDir ?? '.');
        const force = opts.force === true;

        // TTY detection
        if (!opts.nonInteractive && !process.stdin.isTTY) {
          throw new CliError(
            'Interactive mode requires a TTY',
            'stdin is not connected to a terminal',
            'Use: yclaw init --non-interactive --preset local-demo',
          );
        }

        // Non-interactive requires --preset
        if (opts.nonInteractive && !opts.preset) {
          throw new CliError(
            '--non-interactive requires --preset',
            'No preset specified for non-interactive mode',
            'Use: yclaw init --non-interactive --preset local-demo',
          );
        }

        output.heading('YCLAW Setup');

        // Resolve plan
        const plan = opts.nonInteractive
          ? runNonInteractive(opts.preset)
          : await runWizard();

        // Warn if --output-dir with docker-compose (M8)
        if (opts.outputDir && opts.outputDir !== '.'
          && plan.compose) {
          output.warn(
            'Docker Compose files reference relative paths '
            + '(build context, volume mounts). '
            + 'Run from the YCLAW repo root for correct behavior.',
          );
        }

        // Generate files
        const configPath = resolve(outputDir, 'yclaw.config.yaml');
        const envPath = resolve(outputDir, '.env');

        output.info('Generating configuration files...');

        await safeWrite(configPath, generateConfigYaml(plan), force);
        output.success(`Created ${configPath}`);

        await safeWrite(envPath, generateEnvFile(plan), force, true);
        output.success(`Created ${envPath} (mode 0600)`);

        // Write CLI metadata sidecar (C2) — deployment.target, llm, etc.
        // This is what deploy/doctor read since these fields aren't in core YAML.
        const cliMetaPath = resolve(outputDir, '.yclaw-cli.json');
        const cliMeta = JSON.stringify({
          deployment: plan.config.deployment,
          llm: plan.config.llm,
          networking: plan.config.networking,
          observability: plan.config.observability,
        }, null, 2);
        await safeWrite(cliMetaPath, cliMeta + '\n', force);
        output.success(`Created ${cliMetaPath}`);

        // Next steps
        console.log('');
        output.heading('Next steps');
        console.log('  1. Fill in your API keys in .env');
        console.log('  2. Run: yclaw doctor');
        console.log('  3. Run: yclaw deploy');
        if (plan.compose) {
          console.log('');
          console.log('  Docker Compose files: deploy/docker-compose/');
          console.log('  Production: docker compose -f deploy/docker-compose/docker-compose.yml up -d');
          console.log('  Dev (build): yclaw deploy --dev');
        }
        console.log('');

        process.exit(0);
      } catch (err) {
        handleError(err);
      }
    });
}
