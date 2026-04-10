/**
 * GitHub App Manifest Generator
 *
 * Generates the manifest JSON that self-hosted users use to create their own
 * GitHub App with one click via the manifest flow.
 *
 * Spec: https://docs.github.com/en/apps/sharing-github-apps/registering-a-github-app-from-a-manifest
 */

import { randomBytes } from 'node:crypto';

/**
 * Generate a GitHub App manifest for self-hosted YClaw instances.
 *
 * @param instanceUrl - The public URL of the YClaw instance (e.g., https://agents.yclaw.ai)
 */
export function generateManifest(instanceUrl: string): Record<string, unknown> {
  // Strip trailing slash
  const baseUrl = instanceUrl.replace(/\/+$/, '');
  const suffix = randomBytes(3).toString('hex');

  return {
    name: `YClaw Agent Orchestrator (${suffix})`,
    url: 'https://yclaw.ai',
    hook_attributes: {
      url: `${baseUrl}/github/webhook`,
      active: true,
    },
    redirect_url: `${baseUrl}/v1/onboarding/github/callback`,
    setup_url: `${baseUrl}/v1/onboarding/github/setup`,
    setup_on_update: true,
    public: false,
    default_permissions: {
      contents: 'write',
      issues: 'write',
      pull_requests: 'write',
      checks: 'read',
      statuses: 'read',
      actions: 'read',
      workflows: 'read',
      metadata: 'read',
    },
    default_events: [
      'check_run',
      'check_suite',
      'issues',
      'issue_comment',
      'pull_request',
      'pull_request_review',
      'pull_request_review_comment',
      'push',
      'workflow_run',
    ],
  };
}
