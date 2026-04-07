import type { Command } from 'commander';
import { confirm } from '@inquirer/prompts';
import { loadConfig } from '../utils/load-config.js';
import { loadProjectEnv } from '../utils/load-env.js';
import { handleError, CliError } from '../utils/errors.js';
import { runDoctor } from './doctor.js';
import { DockerComposeExecutor } from '../deploy/docker-compose.js';
import { TerraformExecutor } from '../deploy/terraform.js';
import { ManualExecutor } from '../deploy/manual.js';
import { verifyDeployment } from '../deploy/verification.js';
import {
  bootstrapRootOperator,
  displayBootstrapResult,
  writeBootstrapToFile,
} from '../deploy/operator-bootstrap.js';
import type { DeploymentExecutor } from '../types.js';
import * as output from '../utils/output.js';

const EXECUTORS: DeploymentExecutor[] = [
  new DockerComposeExecutor(),
  new TerraformExecutor(),
  new ManualExecutor(),
];

export function registerDeployCommand(program: Command): void {
  program
    .command('deploy')
    .description('Deploy YCLAW using the generated configuration')
    .option('--dry-run', 'Show what would be executed without running it')
    .option('--detach', 'Run containers in background')
    .option('--dev', 'Build from source instead of using pre-built images')
    .option('--skip-verification', 'Skip post-deploy health checks')
    .option('--skip-bootstrap', 'Skip root operator creation')
    .option('--bootstrap-output-file <path>', 'Write bootstrap credentials to file (mode 0600)')
    .action(async (opts) => {
      try {
        // Load .env into process.env
        await loadProjectEnv();

        // Load config
        const config = await loadConfig();

        // Preflight checks
        output.heading('Preflight checks');
        const results = await runDoctor();
        const criticalFails = results.filter(
          r => r.critical && r.status === 'fail',
        );

        if (criticalFails.length > 0) {
          throw new CliError(
            'Preflight checks failed',
            criticalFails.map(r => r.what).join('; '),
            'Run: yclaw doctor  for details',
          );
        }

        // Find executor
        const executor = EXECUTORS.find(e => e.canHandle(config));
        if (!executor) {
          throw new CliError(
            'No deployment executor found',
            `deployment.target: ${config.deployment?.target ?? 'not set'}`,
            'Run: yclaw init --force  to regenerate config',
          );
        }

        // Show plan
        const plan = await executor.plan(config);
        output.heading('Deployment Plan');
        for (const line of plan) console.log(`  ${line}`);

        // Confirm (unless dry-run)
        if (!opts.dryRun) {
          if (process.stdin.isTTY) {
            const proceed = await confirm({
              message: 'Proceed with deployment?',
              default: false,
            });
            if (!proceed) {
              output.info('Deployment cancelled.');
              process.exit(130);
            }
          }

          await executor.apply(config, {
            detach: opts.detach === true,
            dryRun: false,
            dev: opts.dev === true,
          });

          // Post-deploy verification (docker-compose and terraform both have reachable endpoints)
          const target = config.deployment?.target;
          if (!opts.skipVerification && (target === 'docker-compose' || target === 'terraform')) {
            const verifyResults = await verifyDeployment(config);
            const criticalVerifyFails = verifyResults.filter(
              r => r.critical && r.status === 'fail',
            );
            if (criticalVerifyFails.length > 0) {
              output.warn('Some health checks failed. Services may still be starting.');
              output.info('Check: docker compose logs');
            }
          }

          // Root operator bootstrap
          if (!opts.skipBootstrap && (target === 'docker-compose' || target === 'terraform')) {
            const setupToken = process.env.YCLAW_SETUP_TOKEN;
            if (setupToken && setupToken.trim().length >= 32) {
              output.heading('Root operator bootstrap');
              const bootstrapResult = await bootstrapRootOperator(config, setupToken);
              displayBootstrapResult(bootstrapResult);

              if (opts.bootstrapOutputFile && bootstrapResult.apiKey) {
                await writeBootstrapToFile(bootstrapResult, opts.bootstrapOutputFile);
              }
            } else {
              output.info('YCLAW_SETUP_TOKEN not set — skipping operator bootstrap.');
              output.info('Set it in .env and run: yclaw deploy --skip-verification');
            }
          }
        } else {
          output.info('Dry run — no changes made.');
        }

        process.exit(0);
      } catch (err) {
        handleError(err);
      }
    });
}
