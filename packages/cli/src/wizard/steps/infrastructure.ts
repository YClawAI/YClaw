import { select } from '@inquirer/prompts';
import type { WizardState, DeploymentTarget } from '../../types.js';

export async function infrastructureStep(
  state: WizardState,
): Promise<WizardState> {
  const target = await select<DeploymentTarget>({
    message: 'How will you deploy YCLAW?',
    choices: [
      {
        name: 'Docker Compose — local containers, easiest to start',
        value: 'docker-compose',
      },
      {
        name: 'Manual — I manage my own infrastructure (AWS/GCP/K8s)',
        value: 'manual',
      },
    ],
    default: state.deployment.target,
  });

  return { ...state, deployment: { target } };
}
