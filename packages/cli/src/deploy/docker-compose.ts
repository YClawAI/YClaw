/**
 * DockerComposeExecutor — deploys/destroys via docker compose.
 *
 * Phase 3a enhancements:
 * - References static compose file from deploy/docker-compose/
 * - Copies .env to compose working directory for reliable env_file resolution
 * - Uses --build flag for dev mode (source checkout)
 * - Always passes --remove-orphans on destroy
 */

import { resolve } from 'node:path';
import { copyFile, access } from 'node:fs/promises';
import type { CliConfig, DeploymentExecutor, DeployOptions, DestroyOptions } from '../types.js';
import { run } from '../utils/exec.js';
import { CliError } from '../utils/errors.js';
import { resolveApiPort, resolveMcPort } from '../utils/ports.js';
import * as output from '../utils/output.js';

/** Path to the static compose file relative to the project root. */
const COMPOSE_DIR = 'deploy/docker-compose';
const COMPOSE_FILE = `${COMPOSE_DIR}/docker-compose.yml`;
const COMPOSE_DEV_FILE = `${COMPOSE_DIR}/docker-compose.dev.yml`;

export class DockerComposeExecutor implements DeploymentExecutor {
  canHandle(config: CliConfig): boolean {
    return config.deployment?.target === 'docker-compose';
  }

  async plan(config: CliConfig): Promise<string[]> {
    const lines: string[] = [];
    const apiPort = resolveApiPort(config);
    const mcPort = resolveMcPort();

    lines.push('Deploy via Docker Compose:');
    lines.push(`  Compose file: ${COMPOSE_FILE}`);
    lines.push('');
    lines.push('Services (always):');
    lines.push('  - yclaw (core runtime)');
    lines.push('  - mission-control (Next.js dashboard)');
    lines.push('');
    lines.push('Bundled infrastructure (via COMPOSE_PROFILES=bundled):');
    lines.push('  - mongodb (state store)');
    lines.push('  - redis (event bus)');
    lines.push('  - postgres (agent memory)');

    const channels = Object.entries(config.channels)
      .filter(([, v]) => v && 'enabled' in v && v.enabled)
      .map(([k]) => k);
    if (channels.length > 0) {
      lines.push('');
      lines.push(`  Channels: ${channels.join(', ')}`);
    }

    lines.push('');
    lines.push(`  API:              http://localhost:${apiPort}`);
    lines.push(`  Mission Control:  http://localhost:${mcPort}`);

    return lines;
  }

  async apply(config: CliConfig, opts: DeployOptions): Promise<void> {
    if (opts.dryRun) {
      const plan = await this.plan(config);
      for (const line of plan) console.log(line);
      return;
    }

    const projectRoot = resolve('.');

    // Verify compose file exists
    const composeFilePath = resolve(projectRoot, COMPOSE_FILE);
    try {
      await access(composeFilePath);
    } catch {
      throw new CliError(
        'Compose file not found',
        `Expected ${composeFilePath}`,
        'Ensure you are running from the YCLAW repository root',
      );
    }

    // Copy .env to compose working directory for reliable env_file resolution
    const sourceEnv = resolve(projectRoot, '.env');
    const targetEnv = resolve(projectRoot, COMPOSE_DIR, '.env');
    try {
      await copyFile(sourceEnv, targetEnv);
    } catch {
      throw new CliError(
        '.env file not found',
        `Expected ${sourceEnv}`,
        'Run: yclaw init  to generate configuration files',
      );
    }

    const spin = output.spinner('Starting Docker Compose...');
    spin.start();

    // Build compose command args
    const args = ['compose', '-f', composeFilePath];

    // Dev mode: build from source using the dev override file
    if (opts.dev) {
      const devFilePath = resolve(projectRoot, COMPOSE_DEV_FILE);
      try {
        await access(devFilePath);
      } catch {
        throw new CliError(
          'Dev override not found',
          `Expected ${devFilePath}`,
          'Dev mode requires a source checkout of the YCLAW repository',
        );
      }
      args.push('-f', devFilePath);
    }

    args.push('up', '-d');
    if (opts.dev) args.push('--build');

    const result = await run('docker', args, 600_000);

    if (result.exitCode !== 0) {
      spin.fail('Docker Compose failed');
      throw new CliError(
        'Deployment failed',
        result.stderr || 'docker compose up returned non-zero exit code',
        'Check: docker compose logs',
      );
    }

    spin.succeed('YCLAW is running');
    console.log('');
    output.success(
      `API:              http://localhost:${resolveApiPort(config)}`,
    );
    output.success(
      `Mission Control:  http://localhost:${resolveMcPort()}`,
    );
  }

  async destroy(_config: CliConfig, opts: DestroyOptions): Promise<void> {
    const projectRoot = resolve('.');
    const composeFilePath = resolve(projectRoot, COMPOSE_FILE);

    const spin = output.spinner('Stopping Docker Compose...');
    spin.start();

    const args = ['compose', '-f', composeFilePath, 'down', '--remove-orphans'];
    if (opts.volumes) args.push('-v');

    const result = await run('docker', args, 120_000);

    if (result.exitCode !== 0) {
      spin.fail('Teardown failed');
      throw new CliError(
        'Teardown failed',
        result.stderr || 'docker compose down returned non-zero exit code',
        'Try: docker compose down -v --remove-orphans',
      );
    }

    spin.succeed('YCLAW infrastructure destroyed');
    if (opts.volumes) {
      output.info('Persistent data volumes removed');
    }
  }
}
