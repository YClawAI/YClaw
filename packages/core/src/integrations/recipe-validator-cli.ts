#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { validateRecipe } from './recipe-validator.js';

const RECIPES_DIR = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  'recipes',
);

function main(): void {
  const args = process.argv.slice(2);

  // If specific files are passed, validate only those
  let files: string[];
  if (args.length > 0) {
    files = args.map((a) => (path.isAbsolute(a) ? a : path.resolve(process.cwd(), a)));
  } else {
    // Auto-discover all recipe files
    if (!fs.existsSync(RECIPES_DIR)) {
      console.error(`Recipes directory not found: ${RECIPES_DIR}`);
      process.exit(1);
    }
    files = fs
      .readdirSync(RECIPES_DIR)
      .filter((f) => f.endsWith('.recipe.yaml'))
      .map((f) => path.join(RECIPES_DIR, f));
  }

  if (files.length === 0) {
    console.log('No recipe files found.');
    process.exit(0);
  }

  let totalErrors = 0;
  let totalWarnings = 0;

  console.log(`Validating ${files.length} recipe(s)...\n`);

  // Track integration IDs across files for cross-file uniqueness check
  const integrationIds = new Map<string, string>(); // id → first filename

  for (const file of files) {
    const basename = path.basename(file);

    if (!fs.existsSync(file)) {
      console.log(`  SKIP  ${basename} (file not found)`);
      totalErrors++;
      continue;
    }

    let parsed: unknown;
    try {
      const raw = fs.readFileSync(file, 'utf-8');
      parsed = parseYaml(raw);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`  FAIL  ${basename}`);
      console.log(`        YAML parse error: ${msg}`);
      totalErrors++;
      continue;
    }

    const result = validateRecipe(parsed);

    // Cross-file integration ID uniqueness check
    const integrationId = (parsed as any)?.integration;
    if (integrationId && typeof integrationId === 'string') {
      const existing = integrationIds.get(integrationId);
      if (existing) {
        result.valid = false;
        result.errors.push(
          `Duplicate integration id '${integrationId}' — already defined in ${existing}`,
        );
      } else {
        integrationIds.set(integrationId, basename);
      }
    }

    // Filename/integration ID mismatch warning
    const expectedFilename = `${integrationId}.recipe.yaml`;
    if (integrationId && basename !== expectedFilename) {
      result.warnings.push(
        `Filename '${basename}' doesn't match integration id '${integrationId}' — expected '${expectedFilename}'. ` +
          `This breaks the loader's fast-path lookup.`,
      );
    }

    if (result.valid && result.warnings.length === 0) {
      console.log(`  PASS  ${basename} (tier ${(parsed as any).tier}, detected min tier ${result.detectedMinTier})`);
    } else if (result.valid) {
      console.log(`  WARN  ${basename} (tier ${(parsed as any).tier}, detected min tier ${result.detectedMinTier})`);
      for (const w of result.warnings) {
        console.log(`        warning: ${w}`);
      }
      totalWarnings += result.warnings.length;
    } else {
      console.log(`  FAIL  ${basename}`);
      for (const e of result.errors) {
        console.log(`        error: ${e}`);
      }
      for (const w of result.warnings) {
        console.log(`        warning: ${w}`);
      }
      totalErrors += result.errors.length;
      totalWarnings += result.warnings.length;
    }
  }

  console.log(`\n${files.length} recipes, ${totalErrors} error(s), ${totalWarnings} warning(s)`);

  if (totalErrors > 0) {
    process.exit(1);
  }
}

main();
