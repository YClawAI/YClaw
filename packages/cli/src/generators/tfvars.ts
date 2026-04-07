/**
 * Generate terraform.auto.tfvars.json from CLI config and environment.
 * JSON format is auto-loaded by Terraform and avoids HCL escaping issues.
 */

import type { CliConfig } from '../types.js';

export interface TfvarsInput {
  config: CliConfig;
  env: Record<string, string | undefined>;
}

/**
 * Build a JSON-serializable object for terraform.auto.tfvars.json.
 */
export function generateTfvars(input: TfvarsInput): Record<string, unknown> {
  const { config, env } = input;

  const providerKeyMap: Record<string, string> = {
    anthropic: 'ANTHROPIC_API_KEY',
    openai: 'OPENAI_API_KEY',
    openrouter: 'OPENROUTER_API_KEY',
  };

  const llmProvider = config.llm?.defaultProvider ?? 'anthropic';
  const llmKeyName = providerKeyMap[llmProvider] ?? 'ANTHROPIC_API_KEY';

  const vars: Record<string, unknown> = {
    project_name:    env.YCLAW_PROJECT_NAME ?? 'yclaw',
    aws_region:      env.AWS_REGION ?? 'us-east-1',
    cost_tier:       env.YCLAW_COST_TIER ?? 'starter',
    database_type:   env.YCLAW_DATABASE_TYPE ?? 'external',
    mongodb_uri:     env.MONGODB_URI ?? '',
    core_image:      env.YCLAW_CORE_IMAGE ?? 'yclaw/core:latest',
    mc_image:        env.YCLAW_MC_IMAGE ?? 'yclaw/mission-control:latest',
    llm_provider:    llmProvider,
    llm_api_key:     env[llmKeyName] ?? '',
    setup_token:     env.YCLAW_SETUP_TOKEN ?? '',
    event_bus_secret: env.EVENT_BUS_SECRET ?? '',
    log_retention_days: 14,
  };

  // Optional overrides
  if (env.YCLAW_ACM_CERT_ARN) vars.acm_certificate_arn = env.YCLAW_ACM_CERT_ARN;
  if (env.YCLAW_DOMAIN) vars.domain_name = env.YCLAW_DOMAIN;
  if (env.YCLAW_ECS_CPU) {
    const cpu = parseInt(env.YCLAW_ECS_CPU, 10);
    if (!Number.isNaN(cpu) && cpu > 0) vars.ecs_cpu = cpu;
  }
  if (env.YCLAW_ECS_MEMORY) {
    const mem = parseInt(env.YCLAW_ECS_MEMORY, 10);
    if (!Number.isNaN(mem) && mem > 0) vars.ecs_memory = mem;
  }
  if (env.YCLAW_RDS_INSTANCE) vars.rds_instance_class = env.YCLAW_RDS_INSTANCE;
  if (env.YCLAW_REDIS_NODE) vars.redis_node_type = env.YCLAW_REDIS_NODE;

  return vars;
}

/**
 * Serialize tfvars to JSON string for writing to terraform.auto.tfvars.json.
 */
export function serializeTfvars(vars: Record<string, unknown>): string {
  return JSON.stringify(vars, null, 2) + '\n';
}
