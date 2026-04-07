import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createLogger } from '../logging/logger.js';
import type {
  AgentHubConfig,
  Channel,
  Commit,
  HealthResponse,
  Post,
  PushResponse,
} from './types.js';

// ─── Constants ─────────────────────────────────────────────────────────────

const MAX_RETRIES = 3;
const BASE_BACKOFF_MS = 500;
const REQUEST_TIMEOUT_MS = 30_000;

// ─── AgentHubClient ────────────────────────────────────────────────────────

/**
 * AgentHub REST API client for YClaw agents.
 *
 * Standalone module — zero imports from existing Builder/Dispatcher code.
 * Uses native `fetch` (Node 20+) for HTTP and `child_process` for git bundles.
 */
export class AgentHubClient {
  private readonly log = createLogger('agenthub-client');
  private readonly baseUrl: string;
  private readonly apiKey: string;
  readonly agentId: string;

  constructor(config: AgentHubConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
    this.apiKey = config.apiKey;
    this.agentId = config.agentId;
  }

  // ─── Git Operations ──────────────────────────────────────────────────────

  /**
   * Push a git bundle to AgentHub.
   * Reads the bundle into memory so the body can be retried on failure.
   */
  async pushBundle(bundlePath: string): Promise<PushResponse> {
    // F7: Read into Buffer upfront so retries can resend the body
    const bundleData = readFileSync(bundlePath);
    this.log.debug('Pushing bundle', { path: bundlePath, bytes: bundleData.length });

    return this.fetchWithRetry<PushResponse>('/api/git/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: bundleData,
    });
  }

  /**
   * Fetch a commit as a git bundle and write it to `outputPath`.
   * F13: Uses retry wrapper for transient failure resilience.
   */
  async fetchCommit(hash: string, outputPath: string): Promise<void> {
    const buf = await this.fetchBinaryWithRetry(`/api/git/fetch/${hash}`);
    writeFileSync(outputPath, buf);
    this.log.debug('Fetched commit bundle', { hash, outputPath, bytes: buf.length });
  }

  async listCommits(options?: { agent?: string; limit?: number; offset?: number }): Promise<Commit[]> {
    const params = new URLSearchParams();
    if (options?.agent) params.set('agent', options.agent);
    if (options?.limit) params.set('limit', String(options.limit));
    if (options?.offset) params.set('offset', String(options.offset));
    const qs = params.toString();
    return this.fetchWithRetry(`/api/git/commits${qs ? `?${qs}` : ''}`);
  }

  async getCommit(hash: string): Promise<Commit> {
    return this.fetchWithRetry(`/api/git/commits/${hash}`);
  }

  async getChildren(hash: string): Promise<Commit[]> {
    return this.fetchWithRetry(`/api/git/commits/${hash}/children`);
  }

  async getLeaves(): Promise<Commit[]> {
    return this.fetchWithRetry('/api/git/leaves');
  }

  async getLineage(hash: string): Promise<Commit[]> {
    return this.fetchWithRetry(`/api/git/commits/${hash}/lineage`);
  }

  /**
   * F13: Diff now uses retry wrapper for transient failure resilience.
   */
  async diff(hashA: string, hashB: string): Promise<string> {
    return this.fetchTextWithRetry(`/api/git/diff/${hashA}/${hashB}`);
  }

  // ─── Message Board ───────────────────────────────────────────────────────

  async createPost(channel: string, content: string): Promise<Post> {
    return this.fetchWithRetry(`/api/channels/${encodeURIComponent(channel)}/posts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    });
  }

  async readPosts(channel: string, limit?: number): Promise<Post[]> {
    const qs = limit ? `?limit=${limit}` : '';
    return this.fetchWithRetry(`/api/channels/${encodeURIComponent(channel)}/posts${qs}`);
  }

  async replyToPost(channel: string, postId: number, content: string): Promise<Post> {
    return this.fetchWithRetry(`/api/channels/${encodeURIComponent(channel)}/posts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content, parent_id: postId }),
    });
  }

  // ─── Channels ────────────────────────────────────────────────────────────

  async listChannels(): Promise<Channel[]> {
    return this.fetchWithRetry('/api/channels');
  }

  // ─── Health ──────────────────────────────────────────────────────────────

  async health(): Promise<HealthResponse> {
    const url = `${this.baseUrl}/api/health`;
    const res = await fetch(url, { signal: AbortSignal.timeout(5_000) });
    if (!res.ok) throw new Error(`health check failed: ${res.status}`);
    return res.json() as Promise<HealthResponse>;
  }

  // ─── Git Bundle Helpers ──────────────────────────────────────────────────

  static createBundle(repoDir: string, bundlePath: string, refSpec = '--all'): void {
    execFileSync('git', ['-C', repoDir, 'bundle', 'create', bundlePath, refSpec], {
      timeout: 60_000,
      stdio: 'pipe',
    });
  }

  static unbundle(repoDir: string, bundlePath: string): void {
    execFileSync('git', ['-C', repoDir, 'bundle', 'unbundle', bundlePath], {
      timeout: 60_000,
      stdio: 'pipe',
    });
  }

  // ─── Private ─────────────────────────────────────────────────────────────

  private authHeaders(): Record<string, string> {
    return { Authorization: `Bearer ${this.apiKey}` };
  }

  /**
   * Fetch JSON with retry and exponential backoff.
   */
  private async fetchWithRetry<T>(path: string, init?: RequestInit): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      ...this.authHeaders(),
      ...(init?.headers as Record<string, string> | undefined),
    };

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const res = await fetch(url, {
          ...init,
          headers,
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });

        if (!res.ok) {
          const body = await res.text().catch(() => '');
          const err = new Error(`AgentHub ${init?.method ?? 'GET'} ${path}: ${res.status} — ${body}`);
          if (res.status >= 400 && res.status < 500 && res.status !== 429) throw err;
          if (attempt < MAX_RETRIES) {
            const delay = BASE_BACKOFF_MS * Math.pow(2, attempt);
            this.log.warn('AgentHub request failed, retrying', {
              path, status: res.status, attempt: attempt + 1, delayMs: delay,
            });
            await sleep(delay);
            continue;
          }
          throw err;
        }

        return await res.json() as T;
      } catch (err) {
        if (attempt < MAX_RETRIES && isRetryable(err)) {
          const delay = BASE_BACKOFF_MS * Math.pow(2, attempt);
          this.log.warn('AgentHub request error, retrying', {
            path, error: err instanceof Error ? err.message : String(err),
            attempt: attempt + 1, delayMs: delay,
          });
          await sleep(delay);
          continue;
        }
        throw err;
      }
    }
    throw new Error(`AgentHub request exhausted retries: ${path}`);
  }

  /**
   * Fetch plain text with retry (for diff endpoint).
   */
  private async fetchTextWithRetry(path: string): Promise<string> {
    const url = `${this.baseUrl}${path}`;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const res = await fetch(url, {
          headers: this.authHeaders(),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        if (!res.ok) {
          const body = await res.text().catch(() => '');
          const err = new Error(`AgentHub GET ${path}: ${res.status} — ${body}`);
          if (res.status >= 400 && res.status < 500 && res.status !== 429) throw err;
          if (attempt < MAX_RETRIES) {
            await sleep(BASE_BACKOFF_MS * Math.pow(2, attempt));
            continue;
          }
          throw err;
        }
        return await res.text();
      } catch (err) {
        if (attempt < MAX_RETRIES && isRetryable(err)) {
          await sleep(BASE_BACKOFF_MS * Math.pow(2, attempt));
          continue;
        }
        throw err;
      }
    }
    throw new Error(`AgentHub request exhausted retries: ${path}`);
  }

  /**
   * Fetch binary data with retry (for bundle download).
   */
  private async fetchBinaryWithRetry(path: string): Promise<Buffer> {
    const url = `${this.baseUrl}${path}`;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const res = await fetch(url, {
          headers: this.authHeaders(),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        if (!res.ok) {
          const body = await res.text().catch(() => '');
          const err = new Error(`AgentHub GET ${path}: ${res.status} — ${body}`);
          if (res.status >= 400 && res.status < 500 && res.status !== 429) throw err;
          if (attempt < MAX_RETRIES) {
            await sleep(BASE_BACKOFF_MS * Math.pow(2, attempt));
            continue;
          }
          throw err;
        }
        return Buffer.from(await res.arrayBuffer());
      } catch (err) {
        if (attempt < MAX_RETRIES && isRetryable(err)) {
          await sleep(BASE_BACKOFF_MS * Math.pow(2, attempt));
          continue;
        }
        throw err;
      }
    }
    throw new Error(`AgentHub request exhausted retries: ${path}`);
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryable(err: unknown): boolean {
  if (err instanceof TypeError) return true; // network errors
  if (err instanceof Error && err.name === 'AbortError') return true; // timeouts
  return false;
}
