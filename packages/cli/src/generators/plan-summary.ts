/**
 * Generate a human-readable plan summary for terminal display.
 */

import type { ResolvedInitPlan } from '../types.js';
import * as output from '../utils/output.js';

export function printPlanSummary(plan: ResolvedInitPlan): void {
  output.heading('Deployment Plan');
  for (const line of plan.summary) {
    console.log(`  ${line}`);
  }

  output.heading('Files to generate');
  console.log('  yclaw.config.yaml');
  console.log('  .env');
  if (plan.compose) {
    console.log('  docker-compose.yaml');
  }

  if (plan.requirements.credentialsRequired.length > 0) {
    output.heading('Credentials needed');
    for (const cred of plan.requirements.credentialsRequired) {
      console.log(`  ${cred}`);
    }
  }

  console.log('');
}
