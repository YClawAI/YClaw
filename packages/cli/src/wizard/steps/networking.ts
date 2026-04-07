import { select } from '@inquirer/prompts';
import type { WizardState } from '../../types.js';

export async function networkingStep(
  state: WizardState,
): Promise<WizardState> {
  const mode = await select({
    message: 'How will agents be accessed?',
    choices: [
      { name: 'Local only — no external access', value: 'local' },
      { name: 'Tailscale — private mesh network (recommended)', value: 'tailscale' },
      { name: 'Public — exposed via domain + TLS', value: 'public' },
    ],
    default: state.networking.mode,
  });

  return {
    ...state,
    networking: {
      ...state.networking,
      mode: mode as WizardState['networking']['mode'],
    },
  };
}
