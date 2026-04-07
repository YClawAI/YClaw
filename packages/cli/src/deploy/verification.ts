/**
 * Post-deploy health verification — polls running services until healthy.
 * Uses Node 20+ built-in fetch (no new dependencies).
 */

import type { CliConfig } from '../types.js';
import { resolveApiPort, resolveMcPort } from '../utils/ports.js';
import * as output from '../utils/output.js';

export interface VerificationCheck {
  id: string;
  title: string;
  url: string;
  critical: boolean;
  maxRetries: number;
}

export type VerificationStatus = 'pass' | 'fail' | 'skip';

export interface VerificationResult {
  id: string;
  title: string;
  status: VerificationStatus;
  message: string;
  critical: boolean;
}

const RETRY_DELAY_MS = 3_000;

/**
 * Build the list of checks based on the config.
 * @param baseUrl — override base URL (e.g., ALB URL for terraform deploys)
 */
export function buildVerificationChecks(config: CliConfig, baseUrl?: string): VerificationCheck[] {
  let apiBase: string;
  let mcBase: string;

  if (baseUrl) {
    // Terraform/cloud deploys: ALB URL serves both API (path-routed) and MC
    apiBase = baseUrl.replace(/\/$/, '');
    mcBase = apiBase;
  } else {
    // Docker Compose: localhost with separate ports
    const apiPort = resolveApiPort(config);
    const mcPort = resolveMcPort();
    apiBase = `http://localhost:${apiPort}`;
    mcBase = `http://localhost:${mcPort}`;
  }

  const checks: VerificationCheck[] = [
    {
      id: 'core-health',
      title: 'Core API health',
      url: `${apiBase}/health`,
      critical: true,
      maxRetries: 10,
    },
    {
      id: 'infra-health',
      title: 'Infrastructure health',
      url: `${apiBase}/health/infra`,
      critical: true,
      maxRetries: 5,
    },
    {
      id: 'mission-control',
      title: 'Mission Control',
      url: `${mcBase}/`,
      critical: false,
      maxRetries: 5,
    },
  ];
  return checks;
}

/**
 * Run a single verification check with retries.
 */
export async function runCheck(
  check: VerificationCheck,
  fetchFn: typeof globalThis.fetch = globalThis.fetch,
): Promise<VerificationResult> {
  for (let attempt = 1; attempt <= check.maxRetries; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5_000);
      const response = await fetchFn(check.url, { signal: controller.signal });
      clearTimeout(timeout);

      if (response.ok) {
        return {
          id: check.id,
          title: check.title,
          status: 'pass',
          message: `${check.url} → ${response.status}`,
          critical: check.critical,
        };
      }

      // Non-OK but service is responding — may still be starting
      if (attempt < check.maxRetries) {
        await delay(RETRY_DELAY_MS);
      }
    } catch {
      // Connection refused, timeout, etc — retry
      if (attempt < check.maxRetries) {
        await delay(RETRY_DELAY_MS);
      }
    }
  }

  return {
    id: check.id,
    title: check.title,
    status: 'fail',
    message: `${check.url} not healthy after ${check.maxRetries} attempts`,
    critical: check.critical,
  };
}

/**
 * Run all verification checks and print results.
 * Returns results array. Caller decides whether to abort on critical failures.
 */
export async function verifyDeployment(
  config: CliConfig,
  fetchFn: typeof globalThis.fetch = globalThis.fetch,
  baseUrl?: string,
): Promise<VerificationResult[]> {
  const checks = buildVerificationChecks(config, baseUrl);
  const results: VerificationResult[] = [];

  output.heading('Post-deploy verification');

  for (const check of checks) {
    const spin = output.spinner(check.title);
    spin.start();

    const result = await runCheck(check, fetchFn);
    results.push(result);

    if (result.status === 'pass') {
      spin.succeed(result.title);
    } else {
      spin.fail(`${result.title} — ${result.message}`);
      if (result.critical) {
        output.warn(`  Fix: check logs with docker compose logs`);
      }
    }
  }

  return results;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
