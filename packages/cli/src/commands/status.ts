/**
 * yclaw status — Diagnostic tool for operators.
 *
 * Fetches detailed health from the YCLAW API and renders it.
 *
 * Exit codes (Council requirement #4):
 *   0 = healthy
 *   1 = degraded
 *   2 = unreachable / auth error / API error
 *
 * Auth chain (Council requirement #2):
 *   --api-key flag → YCLAW_ROOT_API_KEY env → .env file
 *
 * API URL resolution:
 *   --api-url flag → YCLAW_API_URL env → config networking.apiPort → http://localhost:3000
 */

import type { Command } from 'commander';
import { loadProjectEnv } from '../utils/load-env.js';
import { loadConfig } from '../utils/load-config.js';
import { resolveApiPort } from '../utils/ports.js';
import { handleError } from '../utils/errors.js';
import * as output from '../utils/output.js';

/** Shape matching the DetailedHealth response from core. */
interface DetailedHealthResponse {
  status: 'healthy' | 'degraded' | 'unhealthy';
  uptimeSeconds: number;
  timestamp: string;
  components: Record<string, {
    status: 'healthy' | 'unhealthy';
    latencyMs?: number;
    error?: string;
  }>;
  channels: Record<string, {
    status: 'healthy' | 'disabled' | 'unhealthy';
    error?: string;
  }>;
  agents: { total: number; active: number; idle: number; errored: number };
  tasks: { pending: number; running: number; failedLast24h: number };
  recentErrors: Array<{
    timestamp: string;
    errorCode?: string;
    message: string;
    agentId?: string;
    category?: string;
    severity?: string;
    action?: string;
  }>;
}

export function registerStatusCommand(program: Command): void {
  program
    .command('status')
    .description('Show YCLAW system status — infrastructure, channels, agents, tasks, errors')
    .option('--json', 'Output as JSON')
    .option('--verbose', 'Show all components including disabled')
    .option('--api-url <url>', 'YCLAW API URL')
    .option('--api-key <key>', 'Root operator API key')
    .action(async (opts) => {
      if (opts.json) output.setPlainOutput(true);

      let code: number;
      try {
        // Load .env so we can read YCLAW_ROOT_API_KEY and port config
        await loadProjectEnv();

        const apiUrl = resolveApiUrl(opts.apiUrl);
        const apiKey = resolveApiKey(opts.apiKey);

        const result = await fetchStatus(apiUrl, apiKey);

        if (result.type === 'success') {
          if (opts.json) {
            console.log(JSON.stringify(result.data, null, 2));
          } else {
            renderStatus(result.data, opts.verbose === true);
          }
          code = result.data.status === 'healthy' ? 0 : 1;
        } else {
          if (opts.json) {
            console.log(JSON.stringify({ error: result.error, type: result.type }, null, 2));
          } else {
            renderError(result);
          }
          code = 2;
        }
      } catch (err) {
        handleError(err);
        return; // handleError calls process.exit — this is unreachable but satisfies TS
      }

      process.exit(code);
    });
}

// ─── API URL Resolution ────────────────────────────────────────────────────

function resolveApiUrl(flagValue?: string): string {
  if (flagValue) return flagValue;
  if (process.env.YCLAW_API_URL) return process.env.YCLAW_API_URL;

  // Try to read from config
  let port = '3000';
  try {
    // Sync check — loadConfig is async but we just need the port
    port = resolveApiPort();
  } catch {
    // Config not available — use default
  }
  return `http://localhost:${port}`;
}

// ─── API Key Resolution (Council requirement #2) ───────────────────────────

function resolveApiKey(flagValue?: string): string | undefined {
  if (flagValue) return flagValue;
  if (process.env.YCLAW_ROOT_API_KEY) return process.env.YCLAW_ROOT_API_KEY;
  // loadProjectEnv already merged .env into process.env
  return process.env.YCLAW_ROOT_API_KEY;
}

// ─── Fetch ─────────────────────────────────────────────────────────────────

type StatusResult =
  | { type: 'success'; data: DetailedHealthResponse }
  | { type: 'unreachable'; error: string }
  | { type: 'auth_error'; error: string }
  | { type: 'server_error'; error: string };

async function fetchStatus(apiUrl: string, apiKey: string | undefined): Promise<StatusResult> {
  const url = `${apiUrl.replace(/\/$/, '')}/v1/observability/health`;

  const headers: Record<string, string> = {
    'Accept': 'application/json',
  };
  if (apiKey) {
    headers['X-Operator-Key'] = apiKey;
  }

  let response: Response;
  try {
    response = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('ECONNREFUSED') || msg.includes('fetch failed') || msg.includes('timed out')) {
      return { type: 'unreachable', error: `Cannot connect to ${apiUrl} — ${msg}` };
    }
    return { type: 'unreachable', error: msg };
  }

  if (response.status === 401 || response.status === 403) {
    const body = await response.text().catch(() => '');
    return {
      type: 'auth_error',
      error: `Authentication failed (HTTP ${response.status}). ${body || 'Check your API key.'}`,
    };
  }

  if (response.status >= 500) {
    const body = await response.text().catch(() => '');
    return { type: 'server_error', error: `Server error (HTTP ${response.status}): ${body}` };
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    return { type: 'server_error', error: `Unexpected response (HTTP ${response.status}): ${body}` };
  }

  try {
    const data = await response.json() as DetailedHealthResponse;
    return { type: 'success', data };
  } catch {
    return { type: 'server_error', error: 'Invalid JSON response from API' };
  }
}

// ─── Rendering ─────────────────────────────────────────────────────────────

function renderStatus(data: DetailedHealthResponse, verbose: boolean): void {
  const statusIcon = data.status === 'healthy' ? '✅' : data.status === 'degraded' ? '⚠️' : '❌';
  const uptime = formatUptime(data.uptimeSeconds);

  console.log('');
  console.log(output.bold(`YCLAW Status — ${new Date(data.timestamp).toUTCString()}`));
  console.log('━'.repeat(50));

  // Overall
  console.log(`  Status: ${statusIcon} ${data.status}    Uptime: ${uptime}`);
  console.log('');

  // Infrastructure
  console.log(output.bold('Infrastructure'));
  for (const [name, comp] of Object.entries(data.components)) {
    const icon = comp.status === 'healthy' ? '✅' : '❌';
    const latency = comp.latencyMs !== undefined ? `  ${comp.latencyMs}ms` : '';
    const error = comp.error ? `  (${comp.error})` : '';
    console.log(`  ${padRight(name, 24)} ${icon} ${comp.status}${latency}${error}`);
  }
  console.log('');

  // Channels
  const channelEntries = Object.entries(data.channels);
  if (channelEntries.length > 0 || verbose) {
    console.log(output.bold('Channels'));
    if (channelEntries.length === 0) {
      console.log('  No channels configured');
    }
    for (const [name, ch] of channelEntries) {
      if (!verbose && ch.status === 'disabled') continue;
      const icon = ch.status === 'healthy' ? '✅' : ch.status === 'disabled' ? '⊘' : '❌';
      console.log(`  ${padRight(name, 24)} ${icon} ${ch.status}`);
    }
    console.log('');
  }

  // Agents
  console.log(output.bold('Agents'));
  console.log(`  ${data.agents.active} active / ${data.agents.idle} idle / ${data.agents.errored} errored  (${data.agents.total} total)`);
  console.log('');

  // Tasks
  console.log(output.bold('Tasks'));
  console.log(`  Pending:              ${data.tasks.pending}`);
  console.log(`  Running:              ${data.tasks.running}`);
  console.log(`  Failed (last 24h):    ${data.tasks.failedLast24h}`);
  console.log('');

  // Recent Errors
  if (data.recentErrors.length > 0) {
    console.log(output.bold('Recent Errors'));
    for (const err of data.recentErrors.slice(0, 5)) {
      const time = new Date(err.timestamp).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });
      const agent = padRight(err.agentId ?? '—', 12);
      const code = padRight(err.errorCode ?? '—', 22);
      console.log(`  ${time}  ${agent}  ${code}  ${err.message}`);
      if (err.action) {
        console.log(`         ${output.dim(`Fix: ${err.action}`)}`);
      }
    }
    console.log('');
  }

  console.log(output.dim("Run 'yclaw status --verbose' for full details"));
  console.log(output.dim("Run 'yclaw status --json' for machine-readable output"));
}

function renderError(result: Exclude<StatusResult, { type: 'success' }>): void {
  console.log('');
  switch (result.type) {
    case 'unreachable':
      output.fail('YCLAW API unreachable');
      console.error(`  ${result.error}`);
      console.error('');
      console.error('  Check that the YCLAW API is running and accessible.');
      console.error("  Use --api-url to specify the API URL if it's not localhost:3000.");
      break;
    case 'auth_error':
      output.fail('Authentication failed');
      console.error(`  ${result.error}`);
      console.error('');
      console.error('  Provide a root operator API key via:');
      console.error('    --api-key <key>');
      console.error('    YCLAW_ROOT_API_KEY environment variable');
      console.error('    YCLAW_ROOT_API_KEY in .env file');
      break;
    case 'server_error':
      output.fail('API server error');
      console.error(`  ${result.error}`);
      break;
  }
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function padRight(str: string, len: number): string {
  return str.length >= len ? str : str + ' '.repeat(len - str.length);
}
