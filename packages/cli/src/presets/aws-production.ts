import type { WizardState } from '../types.js';

export const awsProductionPreset: WizardState = {
  preset: 'aws-production',
  deployment: { target: 'terraform' },
  storage: {
    state: 'mongodb',
    events: 'redis',
    memory: 'postgresql',
    objects: 's3',
  },
  channels: {
    slack: true,
    telegram: false,
    twitter: false,
    discord: true,
  },
  llm: {
    provider: 'anthropic',
    model: 'claude-sonnet-4-20250514',
  },
  networking: {
    mode: 'public',
    ports: { api: 3000 },
  },
  communication: {
    style: 'balanced',
    departmentOverrides: {},
  },
  credentials: {},
};
