import type { Command } from 'commander';
import type { DoctorCheckResult, CliConfig } from '../types.js';
import { checkNodeVersion } from '../validators/node.js';
import { checkDockerInstalled, checkDockerCompose } from '../validators/docker.js';
import { checkDiskSpace, checkPortAvailable } from '../validators/system.js';
import { checkRequiredCredentials } from '../validators/credentials.js';
import { checkConfigValid } from '../validators/config.js';
import { loadConfig } from '../utils/load-config.js';
import { loadProjectEnv } from '../utils/load-env.js';
import { resolveApiPort } from '../utils/ports.js';
import { handleError } from '../utils/errors.js';
import * as output from '../utils/output.js';

export function registerDoctorCommand(program: Command): void {
  program
    .command('doctor')
    .description('Preflight validation — checks prerequisites for deployment')
    .option('--json', 'Output results as JSON')
    .action(async (opts) => {
      try {
        if (opts.json) output.setPlainOutput(true);
        const results = await runDoctor();

        if (opts.json) {
          console.log(JSON.stringify(results, null, 2));
        } else {
          renderResults(results);
        }

        const hasCriticalFail = results.some(
          r => r.critical && r.status === 'fail',
        );
        process.exit(hasCriticalFail ? 1 : 0);
      } catch (err) {
        handleError(err);
      }
    });
}

/**
 * Run all doctor checks. Returns the full results array.
 * Reused by deploy command for preflight.
 */
export async function runDoctor(): Promise<DoctorCheckResult[]> {
  // Load project .env so credential checks see user-provided values (C1)
  await loadProjectEnv();

  const results: DoctorCheckResult[] = [];

  // Always-run checks
  results.push(checkNodeVersion());
  results.push(await checkDiskSpace());

  // Config check
  const configResult = await checkConfigValid();
  results.push(configResult);

  // Conditional checks based on config
  let config: CliConfig | null = null;
  if (configResult.status === 'pass') {
    try {
      config = await loadConfig();
    } catch {
      // Already reported as config-valid fail
    }
  }

  if (config?.deployment?.target === 'terraform') {
    const { checkTerraformInstalled, checkAwsCli, checkAwsCredentials } = await import(
      '../validators/aws.js'
    );
    results.push(await checkTerraformInstalled());
    results.push(await checkAwsCli());
    results.push(await checkAwsCredentials());

    // External MongoDB requires MONGODB_URI
    const dbType = process.env.YCLAW_DATABASE_TYPE ?? 'external';
    if (dbType === 'external') {
      const mongoUri = process.env.MONGODB_URI ?? '';
      const mongoResult: DoctorCheckResult = mongoUri.length > 0
        ? {
          id: 'mongodb-uri',
          title: 'MongoDB URI',
          status: 'pass',
          what: 'MONGODB_URI is set',
          critical: true,
        }
        : {
          id: 'mongodb-uri',
          title: 'MongoDB URI',
          status: 'fail',
          what: 'MONGODB_URI is required for external database mode',
          why: 'Default database_type is external — you must provide a MongoDB connection string',
          fix: 'Set MONGODB_URI in .env (e.g. MongoDB Atlas free tier)',
          critical: true,
        };
      results.push(mongoResult);
    }
  }

  if (config?.deployment?.target === 'docker-compose') {
    results.push(await checkDockerInstalled());
    results.push(await checkDockerCompose());

    // Port checks
    const ports = [
      parseInt(resolveApiPort(config), 10),
      27017, 6379, 5432,
    ];
    for (const port of ports) {
      results.push(await checkPortAvailable(port));
    }
  }

  // Credential checks — uses centralized derivation (H4)
  if (config) {
    const { getRequiredCredentials } = await import(
      '../validators/required-credentials.js'
    );
    const required = getRequiredCredentials(config);
    results.push(...checkRequiredCredentials(required, process.env));
  }

  return results;
}

function renderResults(results: DoctorCheckResult[]): void {
  output.heading('YCLAW Doctor');

  for (const r of results) {
    switch (r.status) {
      case 'pass':
        output.success(`${r.title}: ${r.what}`);
        break;
      case 'warn':
        output.warn(`${r.title}: ${r.what}`);
        if (r.why) console.log(`    Why: ${r.why}`);
        if (r.fix) console.log(`    Fix: ${r.fix}`);
        break;
      case 'fail':
        output.fail(`${r.title}: ${r.what}`);
        if (r.why) console.log(`    Why: ${r.why}`);
        if (r.fix) console.log(`    Fix: ${r.fix}`);
        break;
    }
  }

  const passes = results.filter(r => r.status === 'pass').length;
  const warns = results.filter(r => r.status === 'warn').length;
  const fails = results.filter(r => r.status === 'fail').length;

  console.log('');
  output.info(`${passes} passed, ${warns} warnings, ${fails} failed`);
}
