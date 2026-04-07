/**
 * Wizard state machine runner.
 * Runs steps sequentially, handles preset shortcuts and non-interactive mode.
 */

import type { WizardState, ResolvedInitPlan, PresetName } from '../types.js';
import { getPreset, isValidPreset } from '../presets/index.js';
import { resolveInitPlan } from '../plan/resolve.js';
import { presetStep } from './steps/preset.js';
import { purposeStep } from './steps/purpose.js';
import { infrastructureStep } from './steps/infrastructure.js';
import { channelsStep } from './steps/channels.js';
import { llmStep } from './steps/llm.js';
import { networkingStep } from './steps/networking.js';
import { communicationStep } from './steps/communication.js';
import { reviewStep } from './steps/review.js';
import { CliError } from '../utils/errors.js';

/** Default empty state — starting point for the wizard. */
function emptyState(): WizardState {
  return {
    preset: null,
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
    llm: { provider: 'anthropic', model: 'claude-sonnet-4-20250514' },
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
}

/**
 * Run the interactive wizard. Returns a ResolvedInitPlan.
 */
export async function runWizard(): Promise<ResolvedInitPlan> {
  let state = emptyState();

  // eslint-disable-next-line no-constant-condition
  while (true) {
    // Step 1: Preset or custom?
    state = await presetStep(state);

    if (state.preset) {
      // Preset selected — load defaults
      state = { ...getPreset(state.preset), credentials: {} };
    } else {
      // Custom flow — run through all steps
      state = await purposeStep(state);
      state = await infrastructureStep(state);
      state = await channelsStep(state);
      state = await llmStep(state);
      state = await networkingStep(state);
      state = await communicationStep(state);
    }

    // Resolve and review
    const plan = resolveInitPlan(state);
    const approved = await reviewStep(plan);

    if (approved) {
      return plan;
    }
    // Rejected — loop back to preset selection
  }
}

/**
 * Non-interactive mode — load preset, resolve plan, return immediately.
 */
export function runNonInteractive(presetName: string): ResolvedInitPlan {
  if (!isValidPreset(presetName)) {
    throw new CliError(
      `Unknown preset: ${presetName}`,
      `Valid presets: local-demo, small-team, aws-production`,
      `Run: yclaw init --preset local-demo --non-interactive`,
    );
  }

  const state = getPreset(presetName as PresetName);

  // Whitelist known credential keys only (H6) — no PATH, HOME, etc.
  const CREDENTIAL_KEYS = new Set([
    'ANTHROPIC_API_KEY',
    'OPENAI_API_KEY',
    'OPENROUTER_API_KEY',
    'SLACK_BOT_TOKEN',
    'TELEGRAM_BOT_TOKEN',
    'DISCORD_BOT_TOKEN',
    'TWITTER_APP_KEY',
    'TWITTER_APP_SECRET',
    'TWITTER_ACCESS_TOKEN',
    'TWITTER_ACCESS_SECRET',
    'GITHUB_TOKEN',
  ]);

  const credentials: Record<string, string> = {};
  for (const key of CREDENTIAL_KEYS) {
    const value = process.env[key];
    if (value) {
      credentials[key] = value;
    }
  }

  return resolveInitPlan({ ...state, credentials });
}
