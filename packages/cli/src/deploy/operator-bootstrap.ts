/**
 * Root operator bootstrap — calls the core API to create the first operator.
 * Requires YCLAW_SETUP_TOKEN in the environment.
 */

import { writeFile } from 'node:fs/promises';
import type { CliConfig } from '../types.js';
import { resolveApiPort } from '../utils/ports.js';
import * as output from '../utils/output.js';

export interface BootstrapResult {
  success: boolean;
  operatorId?: string;
  apiKey?: string;
  alreadyExists?: boolean;
  error?: string;
}

/**
 * Call the bootstrap endpoint to create the root operator.
 * Returns the API key on success, or indicates if operators already exist.
 */
export async function bootstrapRootOperator(
  config: CliConfig,
  setupToken: string,
  fetchFn: typeof globalThis.fetch = globalThis.fetch,
): Promise<BootstrapResult> {
  const port = resolveApiPort(config);
  const url = `http://localhost:${port}/v1/operators/bootstrap`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    const response = await fetchFn(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${setupToken}`,
      },
      body: JSON.stringify({
        displayName: 'Root Operator',
        email: 'root@localhost',
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (response.status === 201) {
      const data = await response.json() as {
        operatorId: string;
        apiKey: string;
      };
      return {
        success: true,
        operatorId: data.operatorId,
        apiKey: data.apiKey,
      };
    }

    if (response.status === 409) {
      return { success: true, alreadyExists: true };
    }

    const body = await response.text();
    return { success: false, error: `HTTP ${response.status}: ${body}` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: msg };
  }
}

/**
 * Display the bootstrap result with prominent API key warning.
 */
export function displayBootstrapResult(result: BootstrapResult): void {
  if (result.alreadyExists) {
    output.info('Root operator already exists — skipping bootstrap.');
    return;
  }

  if (!result.success) {
    output.warn(`Bootstrap failed: ${result.error ?? 'unknown error'}`);
    output.info('You can bootstrap manually later via the API.');
    return;
  }

  console.log('');
  console.log('┌──────────────────────────────────────────────────────────┐');
  console.log('│                    ROOT OPERATOR CREATED                  │');
  console.log('├──────────────────────────────────────────────────────────┤');
  console.log(`│  Operator ID: ${(result.operatorId ?? '').padEnd(42)}│`);
  console.log(`│  API Key:     ${(result.apiKey ?? '').padEnd(42)}│`);
  console.log('├──────────────────────────────────────────────────────────┤');
  console.log('│  SAVE THIS NOW — it will not be shown again.            │');
  console.log('└──────────────────────────────────────────────────────────┘');
  console.log('');
}

/**
 * Optionally write bootstrap credentials to a file (0600 permissions).
 */
export async function writeBootstrapToFile(
  result: BootstrapResult,
  filePath: string,
): Promise<void> {
  if (!result.success || result.alreadyExists || !result.apiKey) return;

  const content = [
    `# YCLAW Root Operator Credentials`,
    `# Generated: ${new Date().toISOString()}`,
    `# DELETE THIS FILE after saving the credentials securely.`,
    ``,
    `OPERATOR_ID=${result.operatorId}`,
    `API_KEY=${result.apiKey}`,
    ``,
  ].join('\n');

  await writeFile(filePath, content, { mode: 0o600 });
  output.success(`Credentials written to ${filePath} (mode 0600)`);
}
