import type { WizardState } from '../types.js';

export const localDemoPreset: WizardState = {
  preset: 'local-demo',
  deployment: { target: 'docker-compose' },
  storage: {
    state: 'mongodb',
    events: 'redis',
    memory: 'postgresql',
    objects: 'local',
  },
  channels: {
    slack: false,
    telegram: false,
    twitter: false,
    discord: false,
  },
  llm: {
    provider: 'anthropic',
    model: 'claude-sonnet-4-20250514',
  },
  networking: {
    mode: 'local',
    ports: { api: 3000 },
  },
  communication: {
    style: 'balanced',
    departmentOverrides: {},
  },
  credentials: {},
};
