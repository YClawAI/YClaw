/**
 * wire_integration handler — receives Strategist trigger from MC and
 * orchestrates Builder tasks for Tier 3 integration wiring.
 *
 * Flow: MC /wire → POST /api/trigger → this handler → Builder tasks → ConnectionReporter → MC
 */

import { ConnectionReporter } from './connection-reporter.js';
import type { Recipe } from './recipe-types.js';

export interface WireIntegrationContext {
  sessionId: string;
  integration: string;
  recipe: Recipe | null;
  /** Per-field scoped secret refs: { fieldKey: "integrations/{name}/{field}" } */
  fieldRefs: Record<string, string>;
  metadata: Record<string, unknown>;
  currentStep: string;
  tier: number;
}

/**
 * Handle the wire_integration task from the Strategist.
 *
 * This is called by the AgentExecutor when the Strategist receives a
 * wire_integration trigger. It:
 * 1. Reads the recipe's remaining fleet steps
 * 2. For each code_task step, dispatches a Builder task
 * 3. Reports progress back to MC via ConnectionReporter
 * 4. On completion, marks the session as connected
 */
export async function handleWireIntegration(
  context: WireIntegrationContext,
  deps: {
    reporter?: ConnectionReporter;
    dispatchBuilderTask?: (task: {
      integration: string;
      stepId: string;
      builderTask: { description: string; files_to_create?: string[]; files_to_modify?: string[] };
      fieldRefs: Record<string, string>;
      metadata: Record<string, unknown>;
    }) => Promise<{ executionId: string }>;
  },
): Promise<{ success: boolean; stepsProcessed: number }> {
  const reporter = deps.reporter ?? new ConnectionReporter();
  const { sessionId, integration, recipe, fieldRefs, metadata } = context;

  if (!recipe) {
    await reporter.updateStatus(sessionId, 'failed', 'No recipe found for integration');
    return { success: false, stepsProcessed: 0 };
  }

  // Find fleet steps starting from currentStep
  const fleetSteps = recipe.steps.filter(
    (s) => s.actor === 'fleet' && s.type === 'code_task',
  );

  let processed = 0;

  for (const step of fleetSteps) {
    // Mark step as active
    await reporter.updateStep(sessionId, step.id, {
      status: 'active',
      detail: 'Builder assigned',
    });

    if (!step.builder_task) {
      await reporter.updateStep(sessionId, step.id, {
        status: 'skipped',
        detail: 'No builder_task defined',
      });
      processed++;
      continue;
    }

    if (deps.dispatchBuilderTask) {
      try {
        const result = await deps.dispatchBuilderTask({
          integration,
          stepId: step.id,
          builderTask: step.builder_task,
          fieldRefs,
          metadata,
        });

        // Step stays ACTIVE — Builder/Deployer will report completion
        // via ConnectionReporter when PR is reviewed, merged, and deployed.
        // We only record the execution ID for tracking.
        await reporter.updateStep(sessionId, step.id, {
          status: 'active',
          detail: `Dispatched (execution ${result.executionId})`,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Builder task failed';
        await reporter.updateStep(sessionId, step.id, {
          status: 'failed',
          detail: msg,
        });
        await reporter.updateStatus(sessionId, 'failed', `Step ${step.id} failed: ${msg}`);
        return { success: false, stepsProcessed: processed };
      }
    } else {
      // No dispatcher — mark as pending for manual/external processing
      await reporter.updateStep(sessionId, step.id, {
        status: 'active',
        detail: 'Awaiting Builder dispatch',
      });
    }

    processed++;
  }

  // Do NOT mark session as connected here.
  // Session stays in 'wiring' until all fleet steps report completion
  // via ConnectionReporter (triggered by PR merge, deploy, smoke test).
  // The PATCH handler will transition to 'connected' when all steps are complete.

  return { success: true, stepsProcessed: processed };
}
