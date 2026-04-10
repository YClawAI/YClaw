/**
 * Single source of truth for default GitHub owner/repo.
 *
 * Resolution order:
 *   1. Environment variables: GITHUB_OWNER, GITHUB_REPO
 *   2. Hardcoded fallback (YClawAI/YClaw)
 *
 * All GitHub action schemas, tool descriptions, reconciler, journaler,
 * and compare utilities MUST import from here instead of defining their own.
 *
 * For forks/new deployments: set GITHUB_OWNER and GITHUB_REPO in your
 * environment. No code changes needed.
 */

export const GITHUB_ORG_DEFAULTS = {
  owner: process.env.GITHUB_OWNER || 'YClawAI',
  repo: process.env.GITHUB_REPO || 'YClaw',
} as const;
