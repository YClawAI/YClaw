/**
 * GitHub App Setup Routes
 *
 * Handles the GitHub App creation (manifest flow) and installation setup.
 * These routes enable self-hosted users to connect GitHub with one click.
 *
 * Routes:
 *   GET  /v1/onboarding/github/manifest   — Returns the manifest JSON
 *   GET  /v1/onboarding/github/install     — Redirects to GitHub App installation
 *   GET  /v1/onboarding/github/callback    — Post-creation callback (manifest flow)
 *   GET  /v1/onboarding/github/setup       — Post-installation callback
 *   POST /v1/onboarding/github/test        — End-to-end connection test
 */

import type { Express, Request, Response } from 'express';
import { createLogger } from '../logging/logger.js';
import { generateManifest } from './github-app-manifest.js';
import {
  getGitHubToken,
  getAuthMethod,
  isGitHubAuthAvailable,
} from '../actions/github/app-auth.js';

const logger = createLogger('github-setup');

/** Resolve the external instance URL from env or request headers. */
function resolveInstanceUrl(req: Request): string {
  if (process.env.YCLAW_EXTERNAL_URL) {
    return process.env.YCLAW_EXTERNAL_URL.replace(/\/+$/, '');
  }
  const forwarded = req.headers['x-forwarded-host'] as string | undefined;
  const proto = (req.headers['x-forwarded-proto'] as string) || 'http';
  const host = forwarded || req.headers.host || 'localhost:3000';
  return `${proto}://${host}`;
}

export function registerGitHubSetupRoutes(app: Express): void {
  // ─── GET /v1/onboarding/github/manifest ─────────────────────────────────
  app.get('/v1/onboarding/github/manifest', (req: Request, res: Response) => {
    const instanceUrl = resolveInstanceUrl(req);
    const manifest = generateManifest(instanceUrl);
    res.json(manifest);
  });

  // ─── GET /v1/onboarding/github/install ──────────────────────────────────
  app.get('/v1/onboarding/github/install', (req: Request, res: Response) => {
    const instanceUrl = resolveInstanceUrl(req);
    const manifest = generateManifest(instanceUrl);
    const encoded = encodeURIComponent(JSON.stringify(manifest));

    // If the shared app slug is known, offer direct installation
    const sharedAppSlug = process.env.GITHUB_APP_SLUG;
    const target = sharedAppSlug
      ? `https://github.com/apps/${sharedAppSlug}/installations/new`
      : `https://github.com/settings/apps/new?manifest=${encoded}`;

    res.set('Location', target).status(302).end();
  });

  // ─── GET /v1/onboarding/github/callback ─────────────────────────────────
  app.get(
    '/v1/onboarding/github/callback',
    async (req: Request, res: Response) => {
      const code = req.query.code as string | undefined;
      if (!code) {
        res.status(400).json({ error: 'Missing code parameter' });
        return;
      }

      try {
        // Exchange the temporary code for app credentials
        const response = await fetch(
          `https://api.github.com/app-manifests/${code}/conversions`,
          {
            method: 'POST',
            headers: {
              'Accept': 'application/vnd.github+json',
              'X-GitHub-Api-Version': '2022-11-28',
            },
          },
        );

        if (!response.ok) {
          const body = await response.text();
          logger.error('Manifest code exchange failed', {
            status: response.status,
            body,
          });
          res.status(502).json({
            error: 'Failed to exchange manifest code',
            details: body,
          });
          return;
        }

        const data = (await response.json()) as {
          id: number;
          slug: string;
          pem: string;
          webhook_secret: string;
          client_id: string;
          client_secret: string;
          html_url: string;
        };

        logger.info('GitHub App created via manifest', {
          appId: data.id,
          slug: data.slug,
        });

        // Return credentials — the user needs to store these
        // (we don't persist them automatically for security)
        // Intentionally omit the raw PEM from the browser response.
        res.set('Cache-Control', 'no-store').json({
          success: true,
          message: 'GitHub App created. Store these credentials securely.',
          app_id: data.id,
          app_slug: data.slug,
          webhook_secret: data.webhook_secret,
          client_id: data.client_id,
          html_url: data.html_url,
          next_step: `Install the app on your repositories: https://github.com/settings/apps/${data.slug}/installations`,
          private_key_step:
            'Generate/download a private key from the GitHub App settings page linked above. This endpoint does not return the PEM.',
          env_vars: {
            GITHUB_APP_ID: String(data.id),
            GITHUB_APP_PRIVATE_KEY: '(generate/download from GitHub App settings; base64-encode for env vars)',
            GITHUB_APP_WEBHOOK_SECRET: data.webhook_secret,
          },
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error('Manifest callback error', { error: msg });
        res.status(500).json({ error: msg });
      }
    },
  );

  // ─── GET /v1/onboarding/github/setup ────────────────────────────────────
  app.get(
    '/v1/onboarding/github/setup',
    async (req: Request, res: Response) => {
      const installationId = req.query.installation_id as string | undefined;
      if (!installationId) {
        res.status(400).json({ error: 'Missing installation_id parameter' });
        return;
      }

      logger.info('GitHub App installed', { installationId });

      // If we have app credentials, verify by listing repos
      if (isGitHubAuthAvailable() && getAuthMethod() === 'app') {
        try {
          const token = await getGitHubToken();
          const reposResponse = await fetch(
            'https://api.github.com/installation/repositories?per_page=100',
            {
              headers: {
                'Accept': 'application/vnd.github+json',
                'Authorization': `Bearer ${token}`,
                'X-GitHub-Api-Version': '2022-11-28',
              },
            },
          );

          if (reposResponse.ok) {
            const reposData = (await reposResponse.json()) as {
              total_count: number;
              repositories: Array<{ full_name: string }>;
            };

            res.json({
              success: true,
              installation_id: installationId,
              repos: reposData.repositories.map((r) => r.full_name),
              total_repos: reposData.total_count,
              message: 'GitHub connected successfully',
            });
            return;
          }
        } catch (err) {
          logger.warn('Failed to list repos after installation', {
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      // Fallback: acknowledge the installation without repo list
      res.json({
        success: true,
        installation_id: installationId,
        message: 'Installation received. Set GITHUB_APP_INSTALLATION_ID to this value.',
        env_vars: {
          GITHUB_APP_INSTALLATION_ID: installationId,
        },
      });
    },
  );

  // ─── POST /v1/onboarding/github/test ────────────────────────────────────
  app.post(
    '/v1/onboarding/github/test',
    async (_req: Request, res: Response) => {
      if (!isGitHubAuthAvailable()) {
        res.status(400).json({
          success: false,
          error:
            'No GitHub auth configured. Set GITHUB_APP_* or GITHUB_TOKEN.',
        });
        return;
      }

      try {
        const token = await getGitHubToken();
        const authMethod = getAuthMethod();

        // Test 1: Verify token works
        const userResponse = await fetch('https://api.github.com/user', {
          headers: {
            'Accept': 'application/vnd.github+json',
            'Authorization': `Bearer ${token}`,
            'X-GitHub-Api-Version': '2022-11-28',
          },
        });

        if (!userResponse.ok) {
          res.json({
            success: false,
            auth_method: authMethod,
            error: `GitHub API returned ${userResponse.status}`,
          });
          return;
        }

        // Test 2: List accessible repos (for App auth, this shows installation scope)
        let repos: string[] = [];
        if (authMethod === 'app') {
          const reposResponse = await fetch(
            'https://api.github.com/installation/repositories?per_page=10',
            {
              headers: {
                'Accept': 'application/vnd.github+json',
                'Authorization': `Bearer ${token}`,
                'X-GitHub-Api-Version': '2022-11-28',
              },
            },
          );
          if (reposResponse.ok) {
            const data = (await reposResponse.json()) as {
              repositories: Array<{ full_name: string }>;
            };
            repos = data.repositories.map((r) => r.full_name);
          }
        } else {
          // PAT: list user repos
          const reposResponse = await fetch(
            'https://api.github.com/user/repos?per_page=10&sort=updated',
            {
              headers: {
                'Accept': 'application/vnd.github+json',
                'Authorization': `Bearer ${token}`,
                'X-GitHub-Api-Version': '2022-11-28',
              },
            },
          );
          if (reposResponse.ok) {
            const data = (await reposResponse.json()) as Array<{
              full_name: string;
            }>;
            repos = data.map((r) => r.full_name);
          }
        }

        res.json({
          success: true,
          auth_method: authMethod,
          repos,
          message: `GitHub connection verified (${authMethod} auth)`,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error('GitHub connection test failed', { error: msg });
        res.json({
          success: false,
          auth_method: getAuthMethod(),
          error: msg,
        });
      }
    },
  );

  logger.info('GitHub setup routes registered');
}
