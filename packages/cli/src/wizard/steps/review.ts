import { confirm } from '@inquirer/prompts';
import type { ResolvedInitPlan } from '../../types.js';
import { printPlanSummary } from '../../generators/plan-summary.js';

/**
 * Show the resolved plan and ask for confirmation.
 * Returns true if approved, false if rejected (go back).
 */
export async function reviewStep(plan: ResolvedInitPlan): Promise<boolean> {
  printPlanSummary(plan);

  return confirm({
    message: 'Proceed with this configuration?',
    default: true,
  });
}
