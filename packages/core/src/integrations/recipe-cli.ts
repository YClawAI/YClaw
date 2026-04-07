#!/usr/bin/env node

/**
 * Recipe CLI — validate, list, and dry-run test integration recipes.
 *
 * Usage:
 *   npx tsx recipe-cli.ts validate [file...]  — Validate recipe files
 *   npx tsx recipe-cli.ts list                — List all available recipes
 *   npx tsx recipe-cli.ts test <recipe> --dry-run — Dry-run test a recipe flow
 */

import fs from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { validateRecipe } from './recipe-validator.js';
import { loadAllRecipes, loadRecipe } from './recipe-loader.js';
import type { Recipe } from './recipe-types.js';

const RECIPES_DIR = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  'recipes',
);

// ── Validate ────────────────────────────────────────────────────────────────

function cmdValidate(args: string[]): void {
  let files: string[];
  if (args.length > 0) {
    files = args.map((a) => (path.isAbsolute(a) ? a : path.resolve(process.cwd(), a)));
  } else {
    if (!fs.existsSync(RECIPES_DIR)) {
      console.error(`Recipes directory not found: ${RECIPES_DIR}`);
      process.exit(1);
    }
    files = fs.readdirSync(RECIPES_DIR)
      .filter((f) => f.endsWith('.recipe.yaml'))
      .map((f) => path.join(RECIPES_DIR, f));
  }

  if (files.length === 0) {
    console.log('No recipe files found.');
    process.exit(0);
  }

  let totalErrors = 0;
  let totalWarnings = 0;
  const integrationIds = new Map<string, string>();

  console.log(`Validating ${files.length} recipe(s)...\n`);

  for (const file of files) {
    const basename = path.basename(file);

    if (!fs.existsSync(file)) {
      console.log(`  SKIP  ${basename} (file not found)`);
      totalErrors++;
      continue;
    }

    let parsed: unknown;
    try {
      parsed = parseYaml(fs.readFileSync(file, 'utf-8'));
    } catch (err) {
      console.log(`  FAIL  ${basename}`);
      console.log(`        YAML parse error: ${err instanceof Error ? err.message : String(err)}`);
      totalErrors++;
      continue;
    }

    const result = validateRecipe(parsed);

    const integrationId = (parsed as any)?.integration;
    if (integrationId && typeof integrationId === 'string') {
      const existing = integrationIds.get(integrationId);
      if (existing) {
        result.valid = false;
        result.errors.push(`Duplicate integration id '${integrationId}' — already in ${existing}`);
      } else {
        integrationIds.set(integrationId, basename);
      }
    }

    const expectedFilename = `${integrationId}.recipe.yaml`;
    if (integrationId && basename !== expectedFilename) {
      result.warnings.push(`Filename '${basename}' doesn't match '${integrationId}' — expected '${expectedFilename}'`);
    }

    if (result.valid && result.warnings.length === 0) {
      console.log(`  PASS  ${basename} (tier ${(parsed as any).tier}, detected min tier ${result.detectedMinTier})`);
    } else if (result.valid) {
      console.log(`  WARN  ${basename} (tier ${(parsed as any).tier}, detected min tier ${result.detectedMinTier})`);
      for (const w of result.warnings) console.log(`        warning: ${w}`);
      totalWarnings += result.warnings.length;
    } else {
      console.log(`  FAIL  ${basename}`);
      for (const e of result.errors) console.log(`        error: ${e}`);
      for (const w of result.warnings) console.log(`        warning: ${w}`);
      totalErrors += result.errors.length;
      totalWarnings += result.warnings.length;
    }
  }

  console.log(`\n${files.length} recipes, ${totalErrors} error(s), ${totalWarnings} warning(s)`);
  if (totalErrors > 0) process.exit(1);
}

// ── List ────────────────────────────────────────────────────────────────────

function cmdList(): void {
  const recipes = loadAllRecipes(RECIPES_DIR);
  if (recipes.length === 0) {
    console.log('No recipes found.');
    return;
  }

  const tierLabels = { 1: 'Simple', 2: 'Guided', 3: 'Full Wiring' } as const;
  const actorCounts = (r: Recipe) => {
    const counts: Record<string, number> = {};
    for (const s of r.steps) {
      counts[s.actor] = (counts[s.actor] ?? 0) + 1;
    }
    return Object.entries(counts).map(([a, n]) => `${a}:${n}`).join(' ');
  };

  console.log(`\n  ${'Integration'.padEnd(16)} ${'Name'.padEnd(22)} ${'Tier'.padEnd(15)} ${'Steps'.padEnd(8)} Actors`);
  console.log(`  ${'─'.repeat(16)} ${'─'.repeat(22)} ${'─'.repeat(15)} ${'─'.repeat(8)} ${'─'.repeat(20)}`);

  for (const r of recipes.sort((a, b) => a.tier - b.tier || a.integration.localeCompare(b.integration))) {
    const tier = `Tier ${r.tier} (${tierLabels[r.tier]})`;
    console.log(`  ${r.integration.padEnd(16)} ${r.name.padEnd(22)} ${tier.padEnd(15)} ${String(r.steps.length).padEnd(8)} ${actorCounts(r)}`);
  }

  console.log(`\n  ${recipes.length} recipe(s) total\n`);
}

// ── Test (dry run) ──────────────────────────────────────────────────────────

function cmdTest(args: string[]): void {
  const integrationId = args[0];
  if (!integrationId) {
    console.error('Usage: recipe-cli test <integration-id> [--dry-run]');
    process.exit(1);
  }

  const recipe = loadRecipe(integrationId, RECIPES_DIR);
  if (!recipe) {
    console.error(`Recipe not found: ${integrationId}`);
    process.exit(1);
  }

  const tierLabels = { 1: 'Simple', 2: 'Guided', 3: 'Full Wiring' } as const;

  console.log(`\n  Recipe: ${recipe.name} (${recipe.integration})`);
  console.log(`  Tier:   ${recipe.tier} — ${tierLabels[recipe.tier]}`);
  if (recipe.description) {
    console.log(`  Desc:   ${recipe.description.slice(0, 80)}`);
  }
  console.log(`  Fields: ${recipe.credential_fields.map((f) => `${f.key}${f.optional ? '?' : ''}`).join(', ')}`);
  console.log(`  Verify: ${recipe.verify ? `${recipe.verify.method} ${recipe.verify.url}` : '(none)'}`);
  console.log();

  console.log('  Step Flow (dry run):');
  for (let i = 0; i < recipe.steps.length; i++) {
    const step = recipe.steps[i]!;
    const prefix = i === recipe.steps.length - 1 ? '  └─' : '  ├─';
    const actorTag = `[${step.actor}]`;
    const typeTag = step.type ? ` (${step.type})` : '';
    console.log(`  ${prefix} ${step.id}: ${step.label} ${actorTag}${typeTag}`);

    if (step.instructions) {
      const preview = step.instructions.split('\n')[0]!.slice(0, 60);
      console.log(`  ${i === recipe.steps.length - 1 ? '   ' : '  │'}   instructions: ${preview}...`);
    }
    if (step.builder_task) {
      console.log(`  ${i === recipe.steps.length - 1 ? '   ' : '  │'}   builder_task: ${step.builder_task.description.split('\n')[0]!.slice(0, 50)}...`);
      if (step.builder_task.files_to_create?.length) {
        console.log(`  ${i === recipe.steps.length - 1 ? '   ' : '  │'}   creates: ${step.builder_task.files_to_create.join(', ')}`);
      }
    }
  }

  console.log('\n  Simulated flow:');
  for (const step of recipe.steps) {
    const action = step.actor === 'human' ? 'User action'
      : step.actor === 'openclaw' ? 'OpenClaw guides'
      : step.actor === 'fleet' ? 'Builder executes'
      : 'System processes';
    console.log(`    [pending] ${action}: ${step.label}`);
  }

  console.log('\n  Dry run complete — no API calls made.\n');
}

// ── Main ────────────────────────────────────────────────────────────────────

function main(): void {
  const args = process.argv.slice(2);
  const command = args[0];

  switch (command) {
    case 'validate':
      cmdValidate(args.slice(1));
      break;
    case 'list':
      cmdList();
      break;
    case 'test':
      cmdTest(args.slice(1));
      break;
    default:
      console.log('Usage: recipe-cli <command> [args]');
      console.log('');
      console.log('Commands:');
      console.log('  validate [file...]    Validate recipe files (or auto-discover all)');
      console.log('  list                  List all available recipes');
      console.log('  test <id> [--dry-run] Dry-run test a recipe flow');
      console.log('');
      if (command) {
        console.error(`Unknown command: ${command}`);
        process.exit(1);
      }
  }
}

main();
