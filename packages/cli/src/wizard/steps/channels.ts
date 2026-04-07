import { checkbox } from '@inquirer/prompts';
import type { WizardState } from '../../types.js';

export async function channelsStep(
  state: WizardState,
): Promise<WizardState> {
  const selected = await checkbox({
    message: 'Which communication channels do you want to enable?',
    choices: [
      { name: 'Discord', value: 'discord' },
      { name: 'Slack', value: 'slack' },
      { name: 'Telegram', value: 'telegram' },
      { name: 'Twitter / X', value: 'twitter' },
    ],
  });

  return {
    ...state,
    channels: {
      slack: selected.includes('slack'),
      telegram: selected.includes('telegram'),
      twitter: selected.includes('twitter'),
      discord: selected.includes('discord'),
    },
  };
}
