/**
 * ManualExecutor — prints instructions instead of executing.
 * Used for AWS/GCP/K8s deployments where the user manages infrastructure.
 */

import type { CliConfig, DeploymentExecutor, DeployOptions, DestroyOptions } from '../types.js';
import * as output from '../utils/output.js';

export class ManualExecutor implements DeploymentExecutor {
  canHandle(config: CliConfig): boolean {
    return config.deployment?.target === 'manual';
  }

  async plan(config: CliConfig): Promise<string[]> {
    return [
      'Manual deployment — you manage the infrastructure.',
      '',
      'Required infrastructure:',
      `  - MongoDB (state store)`,
      `  - Redis (event bus)`,
      `  - PostgreSQL (agent memory)`,
      config.storage.objects.type === 's3'
        ? '  - S3 bucket (object storage)'
        : '  - Local filesystem (object storage)',
      '',
      'Steps:',
      '  1. Provision the above services',
      '  2. Update connection strings in .env',
      '  3. Build: docker build -t yclaw .',
      '  4. Deploy the yclaw image to your infrastructure',
      '  5. Set environment variables from .env',
      '  6. Expose port 3000 (API)',
      '',
      'For architecture details, see: docs/ARCHITECTURE.md',
    ];
  }

  async apply(config: CliConfig, _opts: DeployOptions): Promise<void> {
    const plan = await this.plan(config);
    output.heading('Manual Deployment Instructions');
    for (const line of plan) console.log(`  ${line}`);
    console.log('');
    output.info(
      'Configure your infrastructure, then run: yclaw doctor',
    );
  }

  async destroy(_config: CliConfig, _opts: DestroyOptions): Promise<void> {
    output.heading('Manual Teardown');
    console.log('  Remove the yclaw containers/tasks from your infrastructure.');
    console.log('  Optionally remove the database volumes/instances.');
    console.log('');
    output.info('Infrastructure teardown is your responsibility in manual mode.');
  }
}
