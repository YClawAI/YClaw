import { RecipeSchema } from './recipe-types.js';
import type { Recipe, RecipeStep } from './recipe-types.js';
import { ZodError } from 'zod';

// ── Types ────────────────────────────────────────────────────────────────────

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  detectedMinTier: 1 | 2 | 3;
}

// ── Tier detection helpers ───────────────────────────────────────────────────

function stepRequiresTier2(step: RecipeStep): boolean {
  return step.actor === 'openclaw' || step.type === 'oauth';
}

function stepRequiresTier3(step: RecipeStep): boolean {
  return step.actor === 'fleet' && step.type === 'code_task';
}

function detectMinTier(steps: RecipeStep[]): 1 | 2 | 3 {
  let min: 1 | 2 | 3 = 1;
  for (const step of steps) {
    if (stepRequiresTier3(step)) return 3;
    if (stepRequiresTier2(step)) min = 2;
  }
  return min;
}

// ── Validator ────────────────────────────────────────────────────────────────

/**
 * Validate a recipe object (already parsed from YAML).
 * Performs schema validation, tier mismatch detection, and consistency checks.
 */
export function validateRecipe(raw: unknown): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // 1. Schema validation via Zod
  let recipe: Recipe;
  try {
    recipe = RecipeSchema.parse(raw);
  } catch (err) {
    if (err instanceof ZodError) {
      for (const issue of err.issues) {
        errors.push(`${issue.path.join('.')}: ${issue.message}`);
      }
    } else {
      errors.push(err instanceof Error ? err.message : 'Unknown schema error');
    }
    return { valid: false, errors, warnings, detectedMinTier: 1 };
  }

  // 2. Auto-detect minimum tier from steps
  const detectedMinTier = detectMinTier(recipe.steps);

  // 3. Tier mismatch check
  if (recipe.tier < detectedMinTier) {
    const escalatingSteps = recipe.steps
      .filter((s) => stepRequiresTier2(s) || stepRequiresTier3(s))
      .map((s) => `${s.id} (actor=${s.actor}${s.type ? `, type=${s.type}` : ''})`)
      .join(', ');

    errors.push(
      `Recipe declares tier ${recipe.tier} but contains steps requiring tier ${detectedMinTier}. ` +
        `Escalating steps: ${escalatingSteps}`,
    );
  }

  // 4. Step id uniqueness
  const stepIds = new Set<string>();
  for (const step of recipe.steps) {
    if (stepIds.has(step.id)) {
      errors.push(`Duplicate step id: '${step.id}'`);
    }
    stepIds.add(step.id);
  }

  // 5. Verify block consistency
  if (recipe.verify) {
    // Check that credential field placeholders in headers reference defined fields
    const fieldKeys = new Set(recipe.credential_fields.map((f) => f.key));
    if (recipe.verify.headers) {
      for (const [header, value] of Object.entries(recipe.verify.headers)) {
        const placeholders = value.match(/\{([^}]+)\}/g);
        if (placeholders) {
          for (const ph of placeholders) {
            const key = ph.slice(1, -1);
            if (!fieldKeys.has(key)) {
              errors.push(
                `Verify header '${header}' references '{${key}}' but no credential field with key '${key}' exists`,
              );
            }
          }
        }
      }
    }
  } else if (recipe.steps.some((s) => s.id === 'verify')) {
    warnings.push('Recipe has a verify step but no verify block — verification will be skipped');
  }

  // 6. Tier > declared is fine (over-classification) but worth warning
  if (recipe.tier > detectedMinTier) {
    warnings.push(
      `Recipe declares tier ${recipe.tier} but detected steps only require tier ${detectedMinTier}. ` +
        `Consider downgrading to tier ${detectedMinTier} for simpler UX.`,
    );
  }

  return { valid: errors.length === 0, errors, warnings, detectedMinTier };
}
