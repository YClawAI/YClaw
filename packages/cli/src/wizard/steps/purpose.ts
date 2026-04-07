import { select } from '@inquirer/prompts';
import type { WizardState } from '../../types.js';

export async function purposeStep(
  state: WizardState,
): Promise<WizardState> {
  const purpose = await select({
    message: 'What is the purpose of this deployment?',
    choices: [
      { name: 'Evaluate — try it out locally', value: 'evaluate' },
      { name: 'Small Team — run for a small organization', value: 'team' },
      { name: 'Production — full deployment for an organization', value: 'production' },
    ],
  });

  // Purpose influences default choices downstream
  if (purpose === 'evaluate') {
    return { ...state, deployment: { target: 'docker-compose' } };
  }
  if (purpose === 'production') {
    return { ...state, storage: { ...state.storage, objects: 's3' } };
  }
  return state;
}
