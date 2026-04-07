/**
 * TerraformExecutor — deploys/destroys via Terraform for AWS.
 */

import { resolve } from 'node:path';
import { writeFile } from 'node:fs/promises';
import type { CliConfig, DeploymentExecutor, DeployOptions, DestroyOptions } from '../types.js';
import { run } from '../utils/exec.js';
import { CliError } from '../utils/errors.js';
import { generateTfvars, serializeTfvars } from '../generators/tfvars.js';
import * as output from '../utils/output.js';

const TF_DIR = 'deploy/aws';

export class TerraformExecutor implements DeploymentExecutor {
  canHandle(config: CliConfig): boolean {
    return config.deployment?.target === 'terraform';
  }

  async plan(config: CliConfig): Promise<string[]> {
    const lines: string[] = [];
    const region = process.env.AWS_REGION ?? 'us-east-1';
    const tier = process.env.YCLAW_COST_TIER ?? 'starter';
    const dbType = process.env.YCLAW_DATABASE_TYPE ?? 'external';
    const hasCert = Boolean(process.env.YCLAW_ACM_CERT_ARN);

    lines.push('Deploy via Terraform (AWS):');
    lines.push(`  Region: ${region}`);
    lines.push(`  Cost tier: ${tier}`);
    lines.push(`  Terraform dir: ${TF_DIR}/`);
    lines.push('');
    lines.push('AWS Resources:');
    lines.push('  - VPC + subnets + security groups');
    lines.push('  - ECS Fargate cluster (core + mission-control)');
    lines.push('  - Application Load Balancer');
    lines.push('  - RDS PostgreSQL (memory system)');
    lines.push('  - ElastiCache Redis (event bus)');
    lines.push('  - S3 bucket (object storage)');
    lines.push('  - Secrets Manager');
    lines.push('  - CloudWatch log group');

    if (dbType === 'documentdb') {
      lines.push('  - DocumentDB cluster (MongoDB-compatible)');
    } else {
      lines.push('  - External MongoDB (user-provided URI)');
    }

    if (hasCert) {
      lines.push('  - HTTPS via ACM certificate');
    } else {
      lines.push('');
      lines.push('  WARNING: No ACM certificate configured — HTTP only.');
      lines.push('  This is suitable for dev/test only. For production,');
      lines.push('  set YCLAW_ACM_CERT_ARN and YCLAW_DOMAIN in .env.');
    }

    const channels = Object.entries(config.channels)
      .filter(([, v]) => v && 'enabled' in v && v.enabled)
      .map(([k]) => k);
    if (channels.length > 0) {
      lines.push('');
      lines.push(`  Channels: ${channels.join(', ')}`);
    }

    return lines;
  }

  async apply(config: CliConfig, opts: DeployOptions): Promise<void> {
    if (opts.dryRun) {
      const plan = await this.plan(config);
      for (const line of plan) console.log(line);
      return;
    }

    const tfDir = resolve('.', TF_DIR);

    // Generate terraform.auto.tfvars.json
    const vars = generateTfvars({ config, env: process.env });
    const tfvarsPath = resolve(tfDir, 'terraform.auto.tfvars.json');
    await writeFile(tfvarsPath, serializeTfvars(vars), { mode: 0o600 });
    output.success('Generated terraform.auto.tfvars.json');

    // State backend warning
    const tier = process.env.YCLAW_COST_TIER ?? 'starter';
    if (tier === 'production') {
      output.warn('PRODUCTION TIER: Local Terraform state contains secrets in plaintext.');
      output.warn('Configure S3 backend BEFORE deploying production infrastructure.');
      output.info('See: deploy/aws/backend.tf.example');
    } else {
      output.warn('Using local Terraform state. For teams, configure S3 backend.');
      output.info('See: deploy/aws/backend.tf.example');
    }
    console.log('');

    // terraform init
    let spin = output.spinner('terraform init...');
    spin.start();
    const initResult = await run('terraform', ['-chdir=' + tfDir, 'init', '-input=false'], 120_000);
    if (initResult.exitCode !== 0) {
      spin.fail('terraform init failed');
      throw new CliError('Terraform init failed', initResult.stderr, 'Check AWS credentials and network connectivity');
    }
    spin.succeed('terraform init');

    // terraform apply (always fresh plan — no stale planfile)
    spin = output.spinner('terraform apply...');
    spin.start();
    const applyResult = await run(
      'terraform',
      ['-chdir=' + tfDir, 'apply', '-input=false', '-auto-approve'],
      600_000,
    );
    if (applyResult.exitCode !== 0) {
      spin.fail('terraform apply failed');
      throw new CliError('Terraform apply failed', applyResult.stderr, 'Check: terraform -chdir=deploy/aws show');
    }
    spin.succeed('terraform apply');

    // Get outputs
    const outputResult = await run('terraform', ['-chdir=' + tfDir, 'output', '-json']);
    let albUrl = '';
    let clusterName = '';
    let coreServiceName = '';
    let mcServiceName = '';
    if (outputResult.exitCode === 0) {
      try {
        const outputs = JSON.parse(outputResult.stdout) as Record<string, { value: string }>;
        albUrl = outputs.alb_url?.value ?? '';
        clusterName = outputs.ecs_cluster?.value ?? '';
        coreServiceName = outputs.core_service?.value ?? '';
        mcServiceName = outputs.mc_service?.value ?? '';
      } catch {
        // Non-critical — we can continue without parsed outputs
      }
    }

    if (albUrl) {
      console.log('');
      output.success(`YCLAW deployed: ${albUrl}`);
    }

    // Wait for ECS services to stabilize (both core and MC)
    const services = [coreServiceName, mcServiceName].filter(Boolean);
    if (clusterName && services.length > 0) {
      spin = output.spinner('Waiting for ECS services to stabilize...');
      spin.start();
      const waitResult = await run(
        'aws',
        ['ecs', 'wait', 'services-stable',
          '--cluster', clusterName,
          '--services', ...services,
          '--region', process.env.AWS_REGION ?? 'us-east-1'],
        600_000,
      );
      if (waitResult.exitCode === 0) {
        spin.succeed('ECS services stable');
      } else {
        spin.fail('ECS services did not stabilize within timeout');
        output.warn('Services may still be starting. Check ECS console.');
      }
    }
  }

  async destroy(config: CliConfig, opts: DestroyOptions): Promise<void> {
    const tfDir = resolve('.', TF_DIR);

    // Regenerate tfvars to ensure correct state targeting
    const vars = generateTfvars({ config, env: process.env });
    const tfvarsPath = resolve(tfDir, 'terraform.auto.tfvars.json');
    await writeFile(tfvarsPath, serializeTfvars(vars), { mode: 0o600 });

    if (opts.volumes) {
      output.warn('WARNING: This will destroy ALL AWS resources including databases and S3 data.');
    }

    const spin = output.spinner('terraform destroy...');
    spin.start();

    const result = await run(
      'terraform',
      ['-chdir=' + tfDir, 'destroy', '-input=false', '-auto-approve'],
      600_000,
    );

    if (result.exitCode !== 0) {
      spin.fail('terraform destroy failed');
      throw new CliError(
        'Terraform destroy failed',
        result.stderr,
        'Check: terraform -chdir=deploy/aws show',
      );
    }

    spin.succeed('All AWS resources destroyed');
  }
}
