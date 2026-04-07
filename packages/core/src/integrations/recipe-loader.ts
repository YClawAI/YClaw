import fs from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { RecipeSchema } from './recipe-types.js';
import { validateRecipe } from './recipe-validator.js';
import type { Recipe } from './recipe-types.js';

const RECIPES_DIR = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  'recipes',
);

/**
 * Auto-discover and load all *.recipe.yaml files from the recipes directory.
 * Returns only recipes that pass both schema validation and full recipe
 * validation (tier mismatch, duplicate step IDs, verify block consistency).
 * Rejects duplicate integration IDs — first file wins, duplicates are skipped.
 * Invalid files are skipped with warnings logged to stderr.
 */
export function loadAllRecipes(recipesDir?: string): Recipe[] {
  const dir = recipesDir ?? RECIPES_DIR;

  if (!fs.existsSync(dir)) {
    return [];
  }

  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.recipe.yaml'));
  const recipes: Recipe[] = [];
  const seenIds = new Map<string, string>(); // integration id → filename

  for (const file of files) {
    const filePath = path.join(dir, file);
    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const parsed = parseYaml(raw);

      // Full validation (schema + tier mismatch + step uniqueness + verify consistency)
      const result = validateRecipe(parsed);
      if (!result.valid) {
        process.stderr.write(
          `[recipe-loader] Skipping ${file}: ${result.errors.join('; ')}\n`,
        );
        continue;
      }
      for (const w of result.warnings) {
        process.stderr.write(`[recipe-loader] ${file}: warning: ${w}\n`);
      }

      const recipe = RecipeSchema.parse(parsed);

      // Reject duplicate integration IDs
      const existing = seenIds.get(recipe.integration);
      if (existing) {
        process.stderr.write(
          `[recipe-loader] Skipping ${file}: duplicate integration id '${recipe.integration}' (already loaded from ${existing})\n`,
        );
        continue;
      }
      seenIds.set(recipe.integration, file);

      recipes.push(recipe);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[recipe-loader] Skipping ${file}: ${msg}\n`);
    }
  }

  return recipes;
}

/**
 * Load a specific recipe by integration id.
 * Searches for {integration}.recipe.yaml or any file containing matching integration field.
 * Validates the recipe before returning (same checks as loadAllRecipes).
 */
export function loadRecipe(integration: string, recipesDir?: string): Recipe | null {
  const dir = recipesDir ?? RECIPES_DIR;

  // Try direct filename first
  const directPath = path.join(dir, `${integration}.recipe.yaml`);
  if (fs.existsSync(directPath)) {
    const raw = fs.readFileSync(directPath, 'utf-8');
    const parsed = parseYaml(raw);

    // Full validation (same as loadAllRecipes — schema + tier + step uniqueness + verify)
    const result = validateRecipe(parsed);
    if (!result.valid) {
      process.stderr.write(
        `[recipe-loader] Invalid recipe ${integration}.recipe.yaml: ${result.errors.join('; ')}\n`,
      );
      return null;
    }

    return RecipeSchema.parse(parsed);
  }

  // Fallback: scan all recipes for matching integration field
  const all = loadAllRecipes(dir);
  return all.find((r) => r.integration === integration) ?? null;
}
