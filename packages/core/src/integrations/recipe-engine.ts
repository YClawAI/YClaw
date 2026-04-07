import { loadAllRecipes } from './recipe-loader.js';
import type { Recipe, RecipeStep, CredentialField } from './recipe-types.js';

/**
 * Thin wrapper around the recipe loader with convenience methods
 * and in-memory caching for fast repeated lookups.
 */
export class RecipeEngine {
  private readonly recipesDir?: string;
  private cache: Map<string, Recipe> | null = null;

  constructor(recipesDir?: string) {
    this.recipesDir = recipesDir;
  }

  private ensureLoaded(): Map<string, Recipe> {
    if (this.cache) return this.cache;
    const recipes = loadAllRecipes(this.recipesDir);
    this.cache = new Map(recipes.map((r) => [r.integration, r]));
    return this.cache;
  }

  getRecipe(id: string): Recipe | undefined {
    return this.ensureLoaded().get(id);
  }

  getSteps(id: string): RecipeStep[] {
    return this.getRecipe(id)?.steps ?? [];
  }

  getCredentialFields(id: string): CredentialField[] {
    return this.getRecipe(id)?.credential_fields ?? [];
  }

  hasOpenClawSteps(id: string): boolean {
    return this.getSteps(id).some((s) => s.actor === 'openclaw');
  }

  /** Force reload from disk */
  reload(): void {
    this.cache = null;
  }
}
