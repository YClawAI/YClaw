/**
 * Resolve a WizardState into a canonical ResolvedInitPlan.
 *
 * This is the single transform between raw user input and the data
 * that generators consume. All business logic for mapping wizard
 * choices to config values lives here.
 */

import { randomBytes } from 'node:crypto';
import { CliConfigSchema } from '../schema/cli-config-schema.js';
import type {
  WizardState,
  ResolvedInitPlan,
  DockerComposeSpec,
  CliConfig,
} from '../types.js';

/**
 * Transform WizardState → ResolvedInitPlan.
 * Validates the resulting config against CliConfigSchema.
 */
export function resolveInitPlan(state: WizardState): ResolvedInitPlan {
  const config = buildConfig(state);
  const env = buildEnv(state);
  const compose = state.deployment.target === 'docker-compose'
    ? buildCompose(state)
    : null;
  const summary = buildSummary(state);
  const requirements = buildRequirements(state);

  return { config, env, compose, summary, requirements };
}

// ─── Config Builder ─────────────────────────────────────────────────────────

function buildConfig(state: WizardState): CliConfig {
  const raw = {
    storage: {
      state: { type: state.storage.state },
      events: { type: state.storage.events },
      memory: { type: state.storage.memory },
      objects: { type: state.storage.objects },
    },
    // Always use env provider in Phase 2 — credentials in .env only (C2)
    secrets: { provider: 'env' as const },
    // Communication style configuration
    communication: buildCommunicationConfig(state),
    channels: {
      slack: { enabled: state.channels.slack },
      telegram: { enabled: state.channels.telegram },
      twitter: { enabled: state.channels.twitter },
      discord: { enabled: state.channels.discord },
    },
    deployment: { target: state.deployment.target },
    llm: {
      defaultProvider: state.llm.provider,
      defaultModel: state.llm.model,
    },
    networking: {
      apiPort: state.networking.ports.api,
    },
    observability: { logLevel: 'info' as const },
  };

  return CliConfigSchema.parse(raw);
}

// ─── Env Builder ────────────────────────────────────────────────────────────

function buildEnv(state: WizardState): Record<string, string> {
  const env: Record<string, string> = {};

  // Core runtime
  env.NODE_ENV = 'production';
  env.PORT = '3000';
  // API_PORT is the host-side port mapping (compose: ${API_PORT:-3000}:3000)
  env.API_PORT = String(state.networking.ports.api);

  // Database URIs
  if (state.deployment.target === 'docker-compose') {
    // Docker Compose uses service hostnames
    env.MONGODB_URI = 'mongodb://mongodb:27017/yclaw_agents';
    env.REDIS_URL = 'redis://redis:6379';
    env.MEMORY_DATABASE_URL =
      'postgresql://yclaw:yclaw_dev@postgres:5432/yclaw_memory';
  } else {
    // Manual deployment — placeholders the user must fill in (H3)
    env.MONGODB_URI = '';
    env.REDIS_URL = '';
    env.MEMORY_DATABASE_URL = '';
    if (state.storage.objects === 's3') {
      env.YCLAW_S3_BUCKET = '';
      env.AWS_REGION = 'us-east-1';
    }
  }

  // LLM provider key placeholder
  const providerKeyMap: Record<string, string> = {
    anthropic: 'ANTHROPIC_API_KEY',
    openai: 'OPENAI_API_KEY',
    openrouter: 'OPENROUTER_API_KEY',
  };
  const keyName = providerKeyMap[state.llm.provider];
  if (keyName) {
    env[keyName] = state.credentials[keyName] ?? '';
  }

  // Channel tokens
  if (state.channels.slack) {
    env.SLACK_BOT_TOKEN = state.credentials.SLACK_BOT_TOKEN ?? '';
  }
  if (state.channels.telegram) {
    env.TELEGRAM_BOT_TOKEN = state.credentials.TELEGRAM_BOT_TOKEN ?? '';
  }
  if (state.channels.twitter) {
    env.TWITTER_APP_KEY = state.credentials.TWITTER_APP_KEY ?? '';
    env.TWITTER_APP_SECRET = state.credentials.TWITTER_APP_SECRET ?? '';
    env.TWITTER_ACCESS_TOKEN = state.credentials.TWITTER_ACCESS_TOKEN ?? '';
    env.TWITTER_ACCESS_SECRET = state.credentials.TWITTER_ACCESS_SECRET ?? '';
  }
  if (state.channels.discord) {
    env.DISCORD_BOT_TOKEN = state.credentials.DISCORD_BOT_TOKEN ?? '';
  }

  // Security — generate event bus secret and setup token
  env.EVENT_BUS_SECRET = randomHex(32);
  env.YCLAW_SETUP_TOKEN = randomHex(32);

  // Autonomous operation defaults. These match the harness goal: agents should
  // act by default in local installs, while budget enforcement stays disabled
  // until a LiteLLM database is configured.
  env.GOVERNANCE_MODE = 'off';
  env.REACTION_LOOP_ENABLED = 'true';
  env.BUDGET_ENFORCEMENT_ENABLED = 'false';

  // GitHub repo identity is required for real work. Leave blank for the wizard
  // to collect/fill later instead of falling back to stale fork defaults.
  env.GITHUB_OWNER = '';
  env.GITHUB_REPO = '';
  env.GITHUB_APP_ID = state.credentials.GITHUB_APP_ID ?? '';
  env.GITHUB_APP_PRIVATE_KEY = state.credentials.GITHUB_APP_PRIVATE_KEY ?? '';
  env.GITHUB_APP_INSTALLATION_ID = state.credentials.GITHUB_APP_INSTALLATION_ID ?? '';
  env.GITHUB_TOKEN = state.credentials.GITHUB_TOKEN ?? '';

  // Docker Compose profiles — bundled infrastructure by default
  if (state.deployment.target === 'docker-compose') {
    env.COMPOSE_PROFILES = 'bundled';
    env.POSTGRES_PASSWORD = 'yclaw_dev';
    env.MC_PORT = '3001';
    env.NEXTAUTH_SECRET = randomHex(32);
    env.NEXTAUTH_URL = 'http://localhost:3001';
    env.AO_SERVICE_URL = 'http://ao:8420';
    env.AO_AUTH_TOKEN = randomHex(32);
    env.AO_CALLBACK_URL = 'http://yclaw:3000/api/ao/callback';
    env.AO_MAX_CONCURRENT = '2';
    env.YCLAW_AO_PROJECT = 'yclaw';
    env.YCLAW_REPOS = 'YClawAI/YClaw';
  }

  return env;
}

function randomHex(bytes: number): string {
  return randomBytes(bytes).toString('hex');
}

// ─── Docker Compose Builder ─────────────────────────────────────────────────

function buildCompose(state: WizardState): DockerComposeSpec {
  const services: DockerComposeSpec['services'] = {};
  const volumes: Record<string, Record<string, never>> = {};

  // Core YCLAW service
  services.yclaw = {
    build: '.',
    ports: [
      `\${API_PORT:-${state.networking.ports.api}}:3000`,
    ],
    env_file: ['.env'],
    depends_on: {
      mongodb: { condition: 'service_healthy' },
      redis: { condition: 'service_healthy' },
      postgres: { condition: 'service_healthy' },
    },
    volumes: [
      './departments:/app/departments:ro',
      './prompts:/app/prompts:ro',
      'yclaw-objects:/app/data/objects',
      'yclaw-logs:/app/logs',
    ],
  };

  services['mission-control'] = {
    build: {
      context: '.',
      dockerfile: 'packages/mission-control/Dockerfile',
    },
    ports: [
      '${MC_PORT:-3001}:3001',
    ],
    environment: {
      NODE_ENV: '${NODE_ENV:-production}',
      PORT: '3001',
      HOSTNAME: '0.0.0.0',
      YCLAW_API_URL: 'http://yclaw:3000',
      NEXT_PUBLIC_YCLAW_API_URL: `http://localhost:\${API_PORT:-${state.networking.ports.api}}`,
      NEXTAUTH_URL: 'http://localhost:${MC_PORT:-3001}',
    },
    env_file: ['.env'],
    depends_on: {
      yclaw: { condition: 'service_healthy' },
    },
    healthcheck: {
      test: ['CMD', 'wget', '-q', '--spider', 'http://localhost:3001/login'],
      interval: '15s',
      timeout: '5s',
      retries: 5,
    },
  };

  services.ao = {
    build: {
      context: './ao',
      dockerfile: 'Dockerfile',
    },
    ports: [
      '${AO_BRIDGE_PORT:-8420}:8420',
      '${AO_DASHBOARD_PORT:-3002}:3001',
    ],
    env_file: ['.env'],
    environment: {
      AO_AUTH_TOKEN: '${AO_AUTH_TOKEN}',
      AO_CALLBACK_URL: '${AO_CALLBACK_URL}',
      AO_MAX_CONCURRENT: '${AO_MAX_CONCURRENT:-2}',
      REDIS_URL: 'redis://redis:6379',
      YCLAW_AO_PROJECT: '${YCLAW_AO_PROJECT:-yclaw}',
      YCLAW_REPOS: '${YCLAW_REPOS:-YClawAI/YClaw}',
      GITHUB_APP_ID: '${GITHUB_APP_ID}',
      GITHUB_APP_PRIVATE_KEY: '${GITHUB_APP_PRIVATE_KEY}',
      GITHUB_APP_INSTALLATION_ID: '${GITHUB_APP_INSTALLATION_ID}',
      GITHUB_TOKEN: '${GITHUB_TOKEN}',
      ANTHROPIC_API_KEY: '${ANTHROPIC_API_KEY}',
      OPENAI_API_KEY: '${OPENAI_API_KEY}',
    },
    depends_on: {
      yclaw: { condition: 'service_healthy' },
      redis: { condition: 'service_healthy' },
    },
    volumes: [
      'ao-data:/data',
    ],
    healthcheck: {
      test: ['CMD', 'curl', '-fsS', 'http://localhost:8420/health'],
      interval: '15s',
      timeout: '5s',
      retries: 5,
    },
  };

  // MongoDB
  services.mongodb = {
    image: 'mongo:7',
    ports: ['27017:27017'],
    volumes: ['mongodb-data:/data/db'],
    healthcheck: {
      test: ['CMD', 'mongosh', '--eval', "db.adminCommand('ping')"],
      interval: '10s',
      timeout: '5s',
      retries: 5,
    },
  };
  volumes['mongodb-data'] = {};

  // Redis
  services.redis = {
    image: 'redis:7-alpine',
    ports: ['6379:6379'],
    volumes: ['redis-data:/data'],
    healthcheck: {
      test: ['CMD', 'redis-cli', 'ping'],
      interval: '10s',
      timeout: '5s',
      retries: 5,
    },
  };
  volumes['redis-data'] = {};

  // PostgreSQL (memory)
  services.postgres = {
    image: 'postgres:16-alpine',
    ports: ['5432:5432'],
    environment: {
      POSTGRES_DB: 'yclaw_memory',
      POSTGRES_USER: 'yclaw',
      POSTGRES_PASSWORD: '${POSTGRES_PASSWORD:-yclaw_dev}',
    },
    volumes: ['postgres-data:/var/lib/postgresql/data'],
    healthcheck: {
      test: ['CMD-SHELL', 'pg_isready -U yclaw'],
      interval: '10s',
      timeout: '5s',
      retries: 5,
    },
  };
  volumes['postgres-data'] = {};

  // Object storage volume
  volumes['yclaw-objects'] = {};
  volumes['yclaw-logs'] = {};
  volumes['ao-data'] = {};

  return { services, volumes };
}

// ─── Communication Config Builder ────────────────────────────────────────────

function buildCommunicationConfig(state: WizardState): {
  style: {
    default: string;
    department_overrides: Record<string, string>;
    agent_overrides: Record<string, string>;
  };
} | undefined {
  const comm = state.communication;
  const hasOverrides = Object.keys(comm.departmentOverrides).length > 0;

  // Omit communication section entirely if using default balanced with no overrides
  if (comm.style === 'balanced' && !hasOverrides) {
    return undefined;
  }

  return {
    style: {
      default: comm.style,
      department_overrides: comm.departmentOverrides,
      agent_overrides: {},
    },
  };
}

// ─── Summary Builder ────────────────────────────────────────────────────────

function buildSummary(state: WizardState): string[] {
  const lines: string[] = [];

  lines.push(`Preset: ${state.preset ?? 'custom'}`);
  lines.push(`Deployment: ${state.deployment.target}`);
  lines.push(`State store: ${state.storage.state}`);
  lines.push(`Event bus: ${state.storage.events}`);
  lines.push(`Memory: ${state.storage.memory}`);
  lines.push(`Object store: ${state.storage.objects}`);
  lines.push(`LLM: ${state.llm.provider} (${state.llm.model})`);
  lines.push(`Communication style: ${state.communication.style}`);
  const deptOverrides = Object.entries(state.communication.departmentOverrides);
  if (deptOverrides.length > 0) {
    lines.push(`  Department overrides: ${deptOverrides.map(([d, s]) => `${d}=${s}`).join(', ')}`);
  }

  const enabledChannels = Object.entries(state.channels)
    .filter(([, v]) => v)
    .map(([k]) => k);
  lines.push(`Channels: ${enabledChannels.length > 0
    ? enabledChannels.join(', ')
    : 'none'}`);

  lines.push(`API port: ${state.networking.ports.api}`);

  if (state.storage.objects === 's3') {
    lines.push('NOTE: S3 storage requires @aws-sdk/client-s3 installed in the runtime image');
  }

  return lines;
}

// ─── Requirements Builder ───────────────────────────────────────────────────

function buildRequirements(state: WizardState): ResolvedInitPlan['requirements'] {
  const dockerRequired = state.deployment.target === 'docker-compose';

  const credentialsRequired: string[] = [];
  const providerKeyMap: Record<string, string> = {
    anthropic: 'ANTHROPIC_API_KEY',
    openai: 'OPENAI_API_KEY',
    openrouter: 'OPENROUTER_API_KEY',
  };
  const llmKey = providerKeyMap[state.llm.provider];
  if (llmKey) credentialsRequired.push(llmKey);
  if (state.channels.slack) credentialsRequired.push('SLACK_BOT_TOKEN');
  if (state.channels.telegram) credentialsRequired.push('TELEGRAM_BOT_TOKEN');
  if (state.channels.discord) credentialsRequired.push('DISCORD_BOT_TOKEN');
  if (state.channels.twitter) credentialsRequired.push('TWITTER_APP_KEY');

  const portsRequired: number[] = [
    state.networking.ports.api,
  ];
  if (dockerRequired) {
    portsRequired.push(27017, 6379, 5432, 3001, 8420, 3002);
  }

  return { dockerRequired, credentialsRequired, portsRequired };
}
