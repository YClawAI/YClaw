/**
 * Config loading utility — locate, parse YAML, validate, return typed config.
 * Merges .yclaw-cli.json sidecar metadata (deployment, llm, networking, observability)
 * into the core config to produce a full CliConfig.
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { CliConfigSchema } from '../schema/cli-config-schema.js';
import type { CliConfig } from '../types.js';
import { CliError } from './errors.js';

/**
 * Load and validate yclaw.config.yaml + .yclaw-cli.json from the given directory.
 * Throws CliError with actionable fix if the YAML is missing or invalid.
 */
export async function loadConfig(dir: string = '.'): Promise<CliConfig> {
  const configPath = resolve(dir, 'yclaw.config.yaml');

  let raw: string;
  try {
    raw = await readFile(configPath, 'utf-8');
  } catch (err: any) {
    if (err.code === 'ENOENT') {
      throw new CliError(
        'Config file not found',
        `No yclaw.config.yaml in ${resolve(dir)}`,
        'Run: yclaw init',
      );
    }
    throw err;
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = parseYaml(raw) as Record<string, unknown>;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new CliError(
      'Invalid YAML syntax',
      msg,
      'Check yclaw.config.yaml for YAML syntax errors',
    );
  }

  // Merge CLI metadata sidecar (C2) — deployment.target, llm, etc.
  const cliMetaPath = resolve(dir, '.yclaw-cli.json');
  try {
    const metaRaw = await readFile(cliMetaPath, 'utf-8');
    const meta = JSON.parse(metaRaw) as Record<string, unknown>;
    // Merge CLI fields into the parsed config
    if (meta.deployment) parsed.deployment = meta.deployment;
    if (meta.llm) parsed.llm = meta.llm;
    if (meta.networking) parsed.networking = meta.networking;
    if (meta.observability) parsed.observability = meta.observability;
  } catch {
    // No sidecar — that's fine, CLI fields stay as defaults
  }

  const result = CliConfigSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues
      .map(i => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new CliError(
      'Config validation failed',
      `yclaw.config.yaml has schema errors:\n${issues}`,
      'Run: yclaw init --force  to regenerate',
    );
  }

  return result.data;
}
