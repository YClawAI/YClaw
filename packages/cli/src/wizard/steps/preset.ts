import { select } from '@inquirer/prompts';
import type { WizardState, PresetName } from '../../types.js';

export async function presetStep(
  state: WizardState,
): Promise<WizardState> {
  const choice = await select({
    message: 'How would you like to set up YCLAW?',
    choices: [
      { name: 'Local Demo — Docker Compose, all-local, minimal', value: 'local-demo' },
      { name: 'Small Team — Docker Compose, Slack, production-ready', value: 'small-team' },
      { name: 'AWS Production — Managed services, full stack', value: 'aws-production' },
      { name: 'Custom — configure everything manually', value: 'custom' },
    ],
  });

  if (choice === 'custom') {
    return { ...state, preset: null };
  }

  return { ...state, preset: choice as PresetName };
}
