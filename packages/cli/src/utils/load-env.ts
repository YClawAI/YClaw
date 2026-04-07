/**
 * Load a project .env file and merge into process.env.
 * Does NOT override existing env vars (process.env takes precedence).
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

/**
 * Parse a .env file and merge into process.env.
 * Existing env vars are NOT overridden (user's shell env wins).
 */
export async function loadProjectEnv(dir: string = '.'): Promise<void> {
  const envPath = resolve(dir, '.env');

  let content: string;
  try {
    content = await readFile(envPath, 'utf-8');
  } catch {
    // No .env file — nothing to load
    return;
  }

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    // Skip comments and empty lines
    if (!trimmed || trimmed.startsWith('#')) continue;

    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;

    const key = trimmed.slice(0, eqIdx).trim();
    let value = trimmed.slice(eqIdx + 1).trim();

    // Strip surrounding quotes
    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    // Strip inline comments (only for unquoted values)
    const commentIdx = value.indexOf('  #');
    if (commentIdx !== -1) {
      value = value.slice(0, commentIdx).trim();
    }

    // Don't override existing env vars
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}
