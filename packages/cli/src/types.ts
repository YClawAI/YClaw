/**
 * Core types for the YCLAW CLI.
 * All shared interfaces live here — commands, wizard, generators all import from this file.
 */

// ─── CLI Config (inferred from extended schema) ─────────────────────────────

import type { CliConfig as _CliConfig } from './schema/cli-config-schema.js';

export type CliConfig = _CliConfig;

// ─── Wizard State (raw user input from prompts) ─────────────────────────────

export type PresetName = 'local-demo' | 'small-team' | 'aws-production';

export type DeploymentTarget = 'docker-compose' | 'terraform' | 'manual';

export interface WizardState {
  preset: PresetName | null;
  deployment: { target: DeploymentTarget };
  storage: {
    state: 'mongodb';
    events: 'redis';
    memory: 'postgresql';
    objects: 'local' | 's3';
  };
  channels: {
    slack: boolean;
    telegram: boolean;
    twitter: boolean;
    discord: boolean;
  };
  llm: {
    provider: 'anthropic' | 'openai' | 'openrouter';
    model: string;
  };
  networking: {
    mode: 'local' | 'tailscale' | 'public';
    ports: {
      api: number;
    };
  };
  communication: {
    style: 'detailed' | 'balanced' | 'concise';
    departmentOverrides: Record<string, 'detailed' | 'balanced' | 'concise'>;
  };
  credentials: Record<string, string>;
}

// ─── Docker Compose Spec ────────────────────────────────────────────────────

export interface DockerComposeService {
  image?: string;
  build?: string | { context: string; dockerfile?: string };
  ports?: string[];
  environment?: Record<string, string>;
  env_file?: string[];
  volumes?: string[];
  depends_on?: Record<string, { condition: string }>;
  healthcheck?: {
    test: string[];
    interval: string;
    timeout: string;
    retries: number;
  };
}

export interface DockerComposeSpec {
  services: Record<string, DockerComposeService>;
  volumes?: Record<string, Record<string, never>>;
}

// ─── Resolved Init Plan (canonical intermediate) ────────────────────────────

export interface ResolvedInitPlan {
  /** Validated config matching CliConfigSchema. */
  config: CliConfig;
  /** Credential/env variable mappings (secrets go in .env ONLY). */
  env: Record<string, string>;
  /** Docker Compose spec (only if deployment target is docker-compose). */
  compose: DockerComposeSpec | null;
  /** Human-readable plan summary lines. */
  summary: string[];
  /** System requirements derived from the config. */
  requirements: {
    dockerRequired: boolean;
    credentialsRequired: string[];
    portsRequired: number[];
  };
}

// ─── Doctor Check Result ────────────────────────────────────────────────────

export type CheckStatus = 'pass' | 'warn' | 'fail';

export interface DoctorCheckResult {
  /** Unique check identifier (e.g., 'node-version', 'port-3000'). */
  id: string;
  /** Human-readable title. */
  title: string;
  /** Check outcome. */
  status: CheckStatus;
  /** What happened (shown on all statuses). */
  what: string;
  /** Why it failed/warned (only on fail/warn). */
  why?: string;
  /** Actionable fix instruction (only on fail/warn). */
  fix?: string;
  /** If true, deploy aborts when this check fails. */
  critical: boolean;
}

// ─── Deployment Executor ────────────────────────────────────────────────────

export interface DeployOptions {
  detach: boolean;
  dryRun: boolean;
  /** Build from source using dev override (default: false, uses pre-built images). */
  dev: boolean;
}

export interface DestroyOptions {
  volumes: boolean;
}

export interface DeploymentExecutor {
  /** Whether this executor handles the given config. */
  canHandle(config: CliConfig): boolean;
  /** Generate a human-readable deployment plan. */
  plan(config: CliConfig): Promise<string[]>;
  /** Execute the deployment. */
  apply(config: CliConfig, opts: DeployOptions): Promise<void>;
  /** Tear down the deployment. */
  destroy(config: CliConfig, opts: DestroyOptions): Promise<void>;
}
