/**
 * GitHub readiness checks for the harness preflight path.
 *
 * These checks are local-only: they validate that auth and routing inputs are
 * coherent before deploy/startup can silently fall back to YClaw defaults.
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import type { DoctorCheckResult } from '../types.js';

const APP_KEYS = [
  'GITHUB_APP_ID',
  'GITHUB_APP_PRIVATE_KEY',
  'GITHUB_APP_INSTALLATION_ID',
] as const;

const PRIVATE_KEY_PATTERN =
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]+-----END [A-Z ]*PRIVATE KEY-----/;
const GITHUB_NAME_PATTERN = /^[A-Za-z0-9_.-]+$/;

type Env = Record<string, string | undefined>;

export function checkGitHubReadiness(env: Env = process.env): DoctorCheckResult[] {
  return [
    checkGitHubAuth(env),
    checkRepoTarget(env),
    checkWebhookSecret(env),
  ];
}

function checkGitHubAuth(env: Env): DoctorCheckResult {
  const values = APP_KEYS.map(key => [key, clean(env[key])] as const);
  const present = values.filter(([, value]) => value !== '');
  const missing = values
    .filter(([, value]) => value === '')
    .map(([key]) => key);
  const token = clean(env.GITHUB_TOKEN);

  if (present.length === APP_KEYS.length) {
    const appId = clean(env.GITHUB_APP_ID);
    const installationId = clean(env.GITHUB_APP_INSTALLATION_ID);
    const privateKey = clean(env.GITHUB_APP_PRIVATE_KEY);
    const problems: string[] = [];

    if (!/^\d+$/.test(appId)) {
      problems.push('GITHUB_APP_ID must be numeric');
    }
    if (!/^\d+$/.test(installationId)) {
      problems.push('GITHUB_APP_INSTALLATION_ID must be numeric');
    }
    const privateKeyProblem = validatePrivateKey(privateKey);
    if (privateKeyProblem) {
      problems.push(privateKeyProblem);
    }

    if (problems.length > 0) {
      return {
        id: 'github-auth',
        title: 'GitHub App authentication',
        status: 'fail',
        what: 'GitHub App credentials are invalid',
        why: problems.join('; '),
        fix: 'Set GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY, and GITHUB_APP_INSTALLATION_ID in .env using values from the installed GitHub App',
        critical: true,
      };
    }

    return {
      id: 'github-auth',
      title: 'GitHub App authentication',
      status: 'pass',
      what: 'GitHub App credentials are complete and locally parseable',
      critical: true,
    };
  }

  if (present.length > 0) {
    return {
      id: 'github-auth',
      title: 'GitHub App authentication',
      status: 'fail',
      what: 'GitHub App credentials are partially configured',
      why: `Missing: ${missing.join(', ')}`,
      fix: 'Set all GitHub App variables or remove the partial App values and set GITHUB_TOKEN for local PAT fallback',
      critical: true,
    };
  }

  if (token !== '') {
    return {
      id: 'github-auth',
      title: 'GitHub App authentication',
      status: 'warn',
      what: 'GITHUB_TOKEN is set; GitHub App credentials are not configured',
      why: 'PAT fallback can run local GitHub actions, but production webhooks and installation-scoped auth should use a GitHub App',
      fix: 'Prefer GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY, and GITHUB_APP_INSTALLATION_ID for deployed harnesses',
      critical: true,
    };
  }

  return {
    id: 'github-auth',
    title: 'GitHub App authentication',
    status: 'fail',
    what: 'No GitHub App credentials or PAT fallback are configured',
    why: 'AO cannot create branches, open PRs, inspect workflows, or comment on issues without GitHub auth',
    fix: 'Set GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY, and GITHUB_APP_INSTALLATION_ID in .env, or set GITHUB_TOKEN for local-only testing',
    critical: true,
  };
}

function checkRepoTarget(env: Env): DoctorCheckResult {
  const owner = clean(env.GITHUB_OWNER);
  const repo = clean(env.GITHUB_REPO);

  if (owner === '' || repo === '') {
    const missing = [
      owner === '' ? 'GITHUB_OWNER' : null,
      repo === '' ? 'GITHUB_REPO' : null,
    ].filter((value): value is string => value !== null);

    return {
      id: 'github-repo-target',
      title: 'GitHub default repo target',
      status: 'fail',
      what: 'Default GitHub owner/repo is not explicitly configured',
      why: `Missing: ${missing.join(', ')}. Without these values, runtime GitHub actions fall back to the YClawAI/YClaw defaults.`,
      fix: 'Set GITHUB_OWNER and GITHUB_REPO in .env for the deployment target, even when additional repos are registered dynamically',
      critical: true,
    };
  }

  const invalid = [
    GITHUB_NAME_PATTERN.test(owner) ? null : 'GITHUB_OWNER',
    GITHUB_NAME_PATTERN.test(repo) ? null : 'GITHUB_REPO',
  ].filter((value): value is string => value !== null);

  if (invalid.length > 0) {
    return {
      id: 'github-repo-target',
      title: 'GitHub default repo target',
      status: 'fail',
      what: 'Default GitHub owner/repo has invalid format',
      why: `${invalid.join(', ')} must be GitHub owner/repo names, not URLs or owner/repo pairs`,
      fix: 'Use GITHUB_OWNER=your-org and GITHUB_REPO=your-repo',
      critical: true,
    };
  }

  return {
    id: 'github-repo-target',
    title: 'GitHub default repo target',
    status: 'pass',
    what: 'GITHUB_OWNER and GITHUB_REPO are explicitly configured',
    critical: true,
  };
}

function checkWebhookSecret(env: Env): DoctorCheckResult {
  const secret = clean(env.GITHUB_WEBHOOK_SECRET);

  if (secret === '') {
    return {
      id: 'github-webhook-secret',
      title: 'GitHub webhook secret',
      status: 'fail',
      what: 'GITHUB_WEBHOOK_SECRET is not set',
      why: 'Webhook handlers cannot verify GitHub delivery signatures without a shared secret',
      fix: 'Set GITHUB_WEBHOOK_SECRET in .env and configure the same value on the GitHub App webhook',
      critical: true,
    };
  }

  return {
    id: 'github-webhook-secret',
    title: 'GitHub webhook secret',
    status: 'pass',
    what: 'GITHUB_WEBHOOK_SECRET is set',
    critical: true,
  };
}

function validatePrivateKey(value: string): string | null {
  if (looksLikePem(value)) {
    return null;
  }

  const decoded = decodeBase64(value);
  if (decoded && looksLikePem(decoded)) {
    return null;
  }

  if (looksLikePath(value)) {
    try {
      if (!existsSync(value) || !statSync(value).isFile()) {
        return 'GITHUB_APP_PRIVATE_KEY path does not point to a readable file';
      }
      const fileValue = readFileSync(value, 'utf-8');
      return looksLikePem(fileValue)
        ? null
        : 'GITHUB_APP_PRIVATE_KEY file does not contain a PEM private key';
    } catch {
      return 'GITHUB_APP_PRIVATE_KEY path could not be read';
    }
  }

  return 'GITHUB_APP_PRIVATE_KEY must be a PEM value, base64-encoded PEM, or readable file path';
}

function looksLikePem(value: string): boolean {
  return PRIVATE_KEY_PATTERN.test(value);
}

function decodeBase64(value: string): string | null {
  if (!/^[A-Za-z0-9+/=\s]+$/.test(value) || value.length < 32) {
    return null;
  }
  try {
    return Buffer.from(value, 'base64').toString('utf-8');
  } catch {
    return null;
  }
}

function looksLikePath(value: string): boolean {
  return (
    value.startsWith('/')
    || value.startsWith('./')
    || value.startsWith('../')
    || value.endsWith('.pem')
    || value.endsWith('.key')
  );
}

function clean(value: string | undefined): string {
  return value?.trim() ?? '';
}
