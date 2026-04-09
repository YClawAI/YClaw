// ── Types ────────────────────────────────────────────────────────────────────

export interface CredentialField {
  key: string;
  label: string;
  type: 'text' | 'password' | 'oauth';
  placeholder?: string;
  helpUrl?: string;
  optional?: boolean;
}

export interface IntegrationDef {
  id: string;
  name: string;
  description?: string;
  tier: 1 | 2 | 3;
  icon?: string;
  credentialFields: CredentialField[];
  verifyEndpoint?: string;
  verifyMethod?: string;
  /** How to attach the API key to verification requests */
  authStyle?: 'bearer' | 'x-api-key' | 'query-param' | 'custom-header';
  /** Extra headers to include on verification requests */
  verifyHeaders?: Record<string, string>;
  /** Header name for custom-header authStyle */
  authHeader?: string;
  /** Request body for POST verification (e.g., GraphQL query) */
  verifyBody?: string;
  /** Source of this definition */
  source?: 'hardcoded' | 'recipe';
}

// ── Hardcoded Fallbacks ──────────────────────────────────────────────────────
// These serve as baseline when recipe files are unavailable (e.g., client-side).
// Recipe definitions take precedence when loaded server-side.

const HARDCODED: IntegrationDef[] = [
  {
    id: 'openai',
    name: 'OpenAI',
    tier: 1,
    credentialFields: [
      {
        key: 'api_key',
        label: 'API Key',
        type: 'password',
        placeholder: 'sk-...',
        helpUrl: 'https://platform.openai.com/api-keys',
      },
    ],
    verifyEndpoint: 'https://api.openai.com/v1/models',
    verifyMethod: 'GET',
    authStyle: 'bearer',
    source: 'hardcoded',
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    tier: 1,
    credentialFields: [
      {
        key: 'api_key',
        label: 'API Key',
        type: 'password',
        placeholder: 'sk-ant-...',
        helpUrl: 'https://console.anthropic.com/settings/keys',
      },
    ],
    verifyEndpoint: 'https://api.anthropic.com/v1/models',
    verifyMethod: 'GET',
    authStyle: 'x-api-key',
    verifyHeaders: { 'anthropic-version': '2023-06-01' },
    source: 'hardcoded',
  },
  {
    id: 'xai',
    name: 'xAI',
    tier: 1,
    credentialFields: [
      {
        key: 'api_key',
        label: 'API Key',
        type: 'password',
        placeholder: 'xai-...',
        helpUrl: 'https://console.x.ai/',
      },
    ],
    verifyEndpoint: 'https://api.x.ai/v1/models',
    verifyMethod: 'GET',
    authStyle: 'bearer',
    source: 'hardcoded',
  },
  {
    id: 'google',
    name: 'Google AI',
    tier: 1,
    credentialFields: [
      {
        key: 'api_key',
        label: 'API Key',
        type: 'password',
        placeholder: 'AI...',
        helpUrl: 'https://aistudio.google.com/apikey',
      },
    ],
    verifyEndpoint: 'https://generativelanguage.googleapis.com/v1beta/models',
    verifyMethod: 'GET',
    authStyle: 'custom-header',
    authHeader: 'x-goog-api-key',
    source: 'hardcoded',
  },
];

// ── Registry (merged: recipes take precedence over hardcoded) ────────────────

let mergedIntegrations: IntegrationDef[] | null = null;
const registryMap = new Map<string, IntegrationDef>();

function ensureLoaded(): IntegrationDef[] {
  if (mergedIntegrations) return mergedIntegrations;

  // Start with hardcoded as baseline
  const byId = new Map<string, IntegrationDef>();
  for (const def of HARDCODED) {
    byId.set(def.id, def);
  }

  // Try loading recipes server-side (fs is unavailable in browser)
  if (typeof process !== 'undefined' && process.versions?.node) {
    try {
      // Dynamic require to avoid bundling fs in client code
      const fs = require('fs');
      const path = require('path');
      const yaml = require('yaml');

      // Look for recipes in the core package's integrations/recipes dir
      const coreRecipesDir = path.resolve(
        process.cwd(),
        'node_modules/@yclaw/core/dist/integrations/recipes',
      );
      // Also check source directory (for dev mode)
      const srcRecipesDir = path.resolve(
        process.cwd(),
        '../core/src/integrations/recipes',
      );

      const recipesDir = fs.existsSync(coreRecipesDir)
        ? coreRecipesDir
        : fs.existsSync(srcRecipesDir)
          ? srcRecipesDir
          : null;

      if (recipesDir) {
        const files: string[] = fs.readdirSync(recipesDir).filter((f: string) => f.endsWith('.recipe.yaml'));
        const recipeIds = new Set<string>();
        for (const file of files) {
          try {
            const raw = fs.readFileSync(path.join(recipesDir, file), 'utf-8');
            const parsed = yaml.parse(raw);
            if (parsed?.integration && parsed?.name && parsed?.tier) {
              // Full validation (schema + tier mismatch + step uniqueness + verify consistency)
              try {
                const { validateRecipe: vr } = require('@yclaw/core');
                const vResult = vr(parsed);
                if (!vResult.valid) {
                  console.warn(
                    `[integration-registry] Invalid recipe in ${file}: ${vResult.errors.join('; ')} — skipping`,
                  );
                  continue;
                }
              } catch {
                console.warn(
                  `[integration-registry] Invalid recipe in ${file} — skipping`,
                );
                continue;
              }
              // Warn on duplicate recipe integration IDs (first wins)
              if (recipeIds.has(parsed.integration)) {
                console.warn(
                  `[integration-registry] Duplicate recipe id '${parsed.integration}' in ${file} — skipping`,
                );
                continue;
              }
              recipeIds.add(parsed.integration);
              const def = recipeToIntegrationDef(parsed);
              byId.set(def.id, def); // Recipe takes precedence over hardcoded
            }
          } catch {
            // Skip invalid recipe files silently
          }
        }
      }
    } catch {
      // fs/yaml not available — use hardcoded only
    }
  }

  mergedIntegrations = Array.from(byId.values());
  registryMap.clear();
  for (const def of mergedIntegrations) {
    registryMap.set(def.id, def);
  }
  return mergedIntegrations;
}

/** Convert a recipe YAML object to an IntegrationDef */
function recipeToIntegrationDef(recipe: {
  integration: string;
  name: string;
  description?: string;
  tier: 1 | 2 | 3;
  credential_fields?: { key: string; label: string; type: string; placeholder?: string; help_url?: string; help_text?: string; optional?: boolean }[];
  verify?: { method?: string; url?: string; auth_style?: string; auth_header?: string; headers?: Record<string, string>; body?: string };
}): IntegrationDef {
  return {
    id: recipe.integration,
    name: recipe.name,
    description: recipe.description,
    tier: recipe.tier,
    credentialFields: (recipe.credential_fields ?? []).map((f) => ({
      key: f.key,
      label: f.label,
      type: f.type as 'text' | 'password' | 'oauth',
      placeholder: f.placeholder,
      helpUrl: f.help_url,
      optional: f.optional,
    })),
    verifyEndpoint: recipe.verify?.url,
    verifyMethod: recipe.verify?.method,
    authStyle: recipe.verify?.auth_style as IntegrationDef['authStyle'],
    authHeader: recipe.verify?.auth_header,
    verifyHeaders: recipe.verify?.headers,
    verifyBody: recipe.verify?.body,
    source: 'recipe',
  };
}

// ── Public API ───────────────────────────────────────────────────────────────

export function getIntegration(id: string): IntegrationDef | undefined {
  ensureLoaded();
  return registryMap.get(id);
}

export function getAllIntegrations(): IntegrationDef[] {
  return ensureLoaded();
}

export function getIntegrationsByTier(tier: 1 | 2 | 3): IntegrationDef[] {
  return ensureLoaded().filter((i) => i.tier === tier);
}

/** Force reload recipes from disk (useful after adding new recipe files) */
export function reloadRegistry(): void {
  mergedIntegrations = null;
  registryMap.clear();
  ensureLoaded();
}
