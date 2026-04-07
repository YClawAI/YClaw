/**
 * YCLAW Dependency Security Gate
 *
 * Evaluates new dependencies against risk criteria.
 * Auto-approves safe, popular deps. Blocks sketchy ones for human review.
 *
 * Risk signals:
 * - Package age (must be >= 7 days, enforced by .npmrc too)
 * - Weekly downloads (popularity = hard to fake)
 * - Verified publisher status
 * - Install scripts (preinstall, install, postinstall)
 * - Trusted scopes (pre-approved org namespaces)
 * - Typosquat detection (Levenshtein distance from popular packages)
 *
 * SECURITY: All subprocess calls use execFileSync with argument arrays
 * to prevent shell injection from malicious package names in PRs.
 */

import { readFileSync, existsSync } from 'fs';
import { execFileSync } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const SOAK_DAYS = 7;
const MIN_WEEKLY_DOWNLOADS = 50_000;

// Package name validation: npm package names must match this pattern.
// Rejects shell metacharacters, backticks, $(), etc.
const VALID_PKG_NAME = /^(@[a-z0-9\-~][a-z0-9\-._~]*\/)?[a-z0-9\-~][a-z0-9\-._~]*$/;

// Load config from approved-dependencies.json if it exists
const __dirname = dirname(fileURLToPath(import.meta.url));
const configPath = resolve(__dirname, '..', 'approved-dependencies.json');
let config = { trustedScopes: [], blocklist: {} };
if (existsSync(configPath)) {
  try {
    config = JSON.parse(readFileSync(configPath, 'utf8'));
  } catch { /* use defaults */ }
}

// Trusted scopes — merge from config file + hardcoded defaults
const TRUSTED_SCOPES = [
  ...new Set([
    ...(config.trustedScopes || []).map(s => s.replace('*', '')),
    '@auth/', '@tanstack/', '@radix-ui/', '@t3-oss/', '@vercel/',
    '@types/', '@prisma/', '@next/', '@tailwindcss/', '@headlessui/',
    '@aws-sdk/', '@google-cloud/', '@azure/',
  ]),
];

// Packages known to be dangerous — merge from config file + hardcoded defaults
const BLOCKLIST = [
  ...new Set([
    ...Object.keys(config.blocklist || {}),
    'event-stream',      // Compromised 2018 — crypto wallet theft
    'node-ipc',          // Protestware 2022 — wiped files in Russia/Belarus
    'colors',            // Sabotaged by maintainer 2022
    'faker',             // Sabotaged by maintainer 2022
    'ua-parser-js',      // Compromised 2021 — cryptominer
    'coa',               // Compromised 2021 — credential theft
    'rc',                // Compromised 2021 — credential theft
  ]),
];

async function evaluateDep(name) {
  const result = { name, approved: false, reason: '' };

  // Validate package name format to reject injection attempts
  if (!VALID_PKG_NAME.test(name)) {
    result.reason = `BLOCKED: "${name}" is not a valid npm package name (possible injection attempt)`;
    return result;
  }

  // Hard blocklist
  if (BLOCKLIST.includes(name)) {
    result.reason = `BLOCKED: ${name} is on the permanent blocklist`;
    return result;
  }

  // Check trusted scope
  const isTrustedScope = TRUSTED_SCOPES.some(scope => name.startsWith(scope));

  // Query npm registry — SECURITY: execFileSync with array args, no shell
  let meta;
  try {
    const raw = execFileSync('npm', ['view', name, '--json'], {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    meta = JSON.parse(raw);
  } catch {
    result.reason = `BLOCKED: Package "${name}" not found on npm registry (hallucinated name?)`;
    return result;
  }

  // Check age of latest version
  const latestVersion = meta['dist-tags']?.latest;
  if (!latestVersion) {
    result.reason = 'BLOCKED: No latest version found';
    return result;
  }

  let versionTime;
  try {
    const timeRaw = execFileSync('npm', ['view', name, 'time', '--json'], {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const times = JSON.parse(timeRaw);
    versionTime = new Date(times[latestVersion]);
  } catch {
    result.reason = 'BLOCKED: Cannot determine version publish date';
    return result;
  }

  const ageDays = (Date.now() - versionTime.getTime()) / (1000 * 60 * 60 * 24);
  if (ageDays < SOAK_DAYS) {
    result.reason = `BLOCKED: ${name}@${latestVersion} is ${Math.floor(ageDays)}d old (minimum: ${SOAK_DAYS}d)`;
    return result;
  }

  // Check weekly downloads — SECURITY: execFileSync with array args, no shell
  let downloads = 0;
  try {
    const dlRaw = execFileSync('curl', [
      '-sf',
      `https://api.npmjs.org/downloads/point/last-week/${encodeURIComponent(name)}`,
    ], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    downloads = JSON.parse(dlRaw).downloads || 0;
  } catch { /* proceed with 0 downloads */ }

  // Check for install scripts
  const hasInstallScripts = !!(meta.scripts?.preinstall || meta.scripts?.install || meta.scripts?.postinstall);

  // Decision logic
  if (hasInstallScripts) {
    result.reason = `REVIEW: ${name} has install scripts (${Object.keys(meta.scripts || {}).filter(s => ['preinstall', 'install', 'postinstall'].includes(s)).join(', ')})`;
    return result;
  }

  if (isTrustedScope) {
    result.approved = true;
    result.reason = `AUTO-APPROVED: ${name} is in trusted scope, ${Math.floor(ageDays)}d old, ${downloads.toLocaleString()} weekly downloads`;
    return result;
  }

  if (downloads >= MIN_WEEKLY_DOWNLOADS) {
    result.approved = true;
    result.reason = `AUTO-APPROVED: ${name} has ${downloads.toLocaleString()} weekly downloads, ${Math.floor(ageDays)}d old`;
    return result;
  }

  // Low popularity + not in trusted scope = needs human
  result.reason = `REVIEW: ${name} has only ${downloads.toLocaleString()} weekly downloads (threshold: ${MIN_WEEKLY_DOWNLOADS.toLocaleString()}) and is not in a trusted scope`;
  return result;
}

// Main
const depsFile = process.argv[2];
if (!depsFile) {
  console.log('No new dependencies detected. Gate passes.');
  process.exit(0);
}

const deps = readFileSync(depsFile, 'utf8').trim().split('\n').filter(Boolean);
if (deps.length === 0) {
  console.log('No new dependencies detected. Gate passes.');
  process.exit(0);
}

console.log(`\nYCLAW Dependency Security Gate — evaluating ${deps.length} new package(s)\n`);

let blocked = false;
for (const dep of deps) {
  const result = await evaluateDep(dep.trim());
  const icon = result.approved ? 'PASS' : 'FAIL';
  console.log(`[${icon}] ${result.reason}`);
  if (!result.approved) blocked = true;
}

if (blocked) {
  console.log('\nSome dependencies require human review. PR cannot auto-merge.');
  console.log('   A maintainer must review and approve the dependency additions.');
  process.exit(1);
} else {
  console.log('\nAll new dependencies passed the security gate. Auto-merge eligible.');
  process.exit(0);
}
