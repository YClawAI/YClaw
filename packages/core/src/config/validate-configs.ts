#!/usr/bin/env tsx
/**
 * Standalone config validation script.
 *
 * Usage: npm run validate-configs --workspace=packages/core
 * Exit 0 if all configs are valid, exit 1 if any fail.
 */
import { validateAllConfigs } from './loader.js';

const { valid, errors } = validateAllConfigs();

if (errors.length === 0) {
  console.log(`✅ All ${valid.length} agent configs are valid.`);
  process.exit(0);
}

console.error(`\n❌ Config validation failed — ${errors.length} file(s) have errors:\n`);
for (const { file, error } of errors) {
  console.error(`  ${file}:`);
  for (const issue of error.issues) {
    const path = issue.path.length > 0 ? issue.path.join('.') : '(root)';
    console.error(`    ${path}: ${issue.message}`);
  }
  console.error('');
}
if (valid.length > 0) {
  console.error(`  (${valid.length} other config(s) are valid)\n`);
}
process.exit(1);
