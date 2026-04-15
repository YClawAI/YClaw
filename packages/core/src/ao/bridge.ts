import { createLogger } from '../logging/logger.js';
import type { AuditLog } from '../logging/audit.js';
import type {
  AoSpawnRequest,
  AoSpawnResponse,
  AoBatchSpawnRequest,
  AoBatchSpawnResponse,
  AoDeepHealthResponse,
} from './types.js';

const logger = createLogger('ao-bridge');

const DEFAULT_SERVICE_URL = 'http://ao.yclaw.internal:8420';
const SPAWN_TIMEOUT_MS = 30_000;
const MAX_RETRIES = 1;
const CIRCUIT_THRESHOLD = 3;
const CIRCUIT_RESET_MS = 60_000;

function classifyNetworkError(message: string): string {
  const normalized = message.toLowerCase();
  if (normalized.includes('enotfound') || normalized.includes('getaddrinfo')) return 'dns_failure';
  if (normalized.includes('econnrefused')) return 'connection_refused';
  if (normalized.includes('econnreset')) return 'connection_reset';
  if (normalized.includes('aborted') || normalized.includes('timeout')) return 'timeout';
  return 'network_error';
}

export class AoBridge {
  private readonly serviceUrl: string;
  private readonly authToken: string;
  private readonly auditLog: AuditLog;

  // Per-project circuit breaker state
  private circuitState = new Map<string, { failures: number; openUntil: number }>();

  // Optional callback fired when a circuit transitions open → closed or closed → open.
  // Used by the bootstrap layer to post a single "AO recovered" alert without needing
  // a polling loop.
  private circuitChangeCallback: ((repo: string, open: boolean) => void) | null = null;

  constructor(auditLog: AuditLog) {
    this.serviceUrl = process.env.AO_SERVICE_URL || DEFAULT_SERVICE_URL;
    this.authToken = process.env.AO_AUTH_TOKEN || '';
    this.auditLog = auditLog;
  }

  setCircuitChangeCallback(cb: (repo: string, open: boolean) => void): void {
    this.circuitChangeCallback = cb;
  }

  async spawn(request: AoSpawnRequest): Promise<AoSpawnResponse | null> {
    if (this.isCircuitOpen(request.repo)) {
      logger.warn(`[AoBridge] circuit open for ${request.repo} — skipping ao, using fallback`);
      return null;
    }

    const body = JSON.stringify(request);

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const response = await fetch(`${this.serviceUrl}/spawn`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-AO-TOKEN': this.authToken,
          },
          body,
          signal: AbortSignal.timeout(SPAWN_TIMEOUT_MS),
        });

        if (response.status >= 400 && response.status < 500) {
          const errorText = await response.text().catch(() => 'unknown');
          logger.error('[AoBridge] spawn rejected (4xx — not retrying)', {
            status: response.status,
            error: errorText,
            repo: request.repo,
            issueNumber: request.issueNumber,
          });
          this.audit('spawn', 'failed', request, { status: response.status, error: errorText });
          // 4xx is a request problem, not ao being down — don't trip circuit
          return { id: '', status: 'failed', error: `HTTP ${response.status}: ${errorText}` };
        }

        if (!response.ok) {
          const errorText = await response.text().catch(() => 'unknown');
          if (attempt < MAX_RETRIES) {
            logger.warn(`[AoBridge] spawn failed (${response.status}), retrying...`, {
              attempt, error: errorText,
            });
            continue;
          }
          logger.error('[AoBridge] spawn failed after retries', {
            status: response.status, error: errorText,
          });
          this.recordFailure(request.repo);
          this.audit('spawn', 'failed', request, { status: response.status, error: errorText });
          return { id: '', status: 'failed', error: `HTTP ${response.status}: ${errorText}` };
        }

        const result = await response.json() as AoSpawnResponse;
        // 202 means "spawning" or "queued" (async) — normalize for downstream consumers
        if (result.status === 'spawning' || result.status === 'queued') {
          result.status = 'spawned';
        }
        logger.info('[AoBridge] spawn accepted', {
          id: result.id, status: response.status, repo: request.repo, issueNumber: request.issueNumber,
        });
        this.recordSuccess(request.repo);
        this.audit('spawn', 'success', request, { spawnId: result.id });
        return result;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const errorKind = classifyNetworkError(msg);
        if (attempt < MAX_RETRIES) {
          logger.warn(`[AoBridge] spawn ${errorKind}, retrying...`, { attempt, error: msg });
          continue;
        }
        logger.error(`[AoBridge] spawn failed — ${errorKind}`, { error: msg });
        this.recordFailure(request.repo);
        this.audit('spawn', 'failed', request, { error: msg, errorKind });
        return { id: '', status: 'failed', error: `${errorKind}: ${msg}` };
      }
    }

    return null;
  }

  async batchSpawn(request: AoBatchSpawnRequest): Promise<AoBatchSpawnResponse | null> {
    if (this.isCircuitOpen(request.repo)) {
      logger.warn(`[AoBridge] circuit open for ${request.repo} — skipping batch-spawn`);
      return null;
    }

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const response = await fetch(`${this.serviceUrl}/batch-spawn`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-AO-TOKEN': this.authToken,
          },
          body: JSON.stringify(request),
          signal: AbortSignal.timeout(SPAWN_TIMEOUT_MS),
        });

        if (!response.ok) {
          const errorText = await response.text().catch(() => 'unknown');
          if (attempt < MAX_RETRIES && response.status >= 500) {
            logger.warn(`[AoBridge] batch-spawn failed (${response.status}), retrying...`, {
              attempt, error: errorText,
            });
            continue;
          }
          logger.error('[AoBridge] batch-spawn failed', { status: response.status, error: errorText });
          this.recordFailure(request.repo);
          this.audit('batch-spawn', 'failed', request, { status: response.status, error: errorText });
          return null;
        }

        const result = await response.json() as AoBatchSpawnResponse;
        logger.info('[AoBridge] batch-spawn succeeded', {
          count: result.results.length, repo: request.repo,
        });
        this.recordSuccess(request.repo);
        this.audit('batch-spawn', 'success', request, { count: result.results.length });
        return result;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (attempt < MAX_RETRIES) {
          logger.warn('[AoBridge] batch-spawn network error, retrying...', { attempt, error: msg });
          continue;
        }
        logger.error('[AoBridge] batch-spawn failed — ao unreachable', { error: msg });
        this.recordFailure(request.repo);
        this.audit('batch-spawn', 'failed', request, { error: msg });
        return null;
      }
    }

    return null;
  }

  async health(): Promise<boolean> {
    try {
      const response = await fetch(`${this.serviceUrl}/health`, {
        signal: AbortSignal.timeout(5_000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Calls `/health/deep` on the AO service and returns structured component-level
   * health data including queue depth and circuit breaker states.
   *
   * Intentionally bypasses the circuit breaker — this is a monitoring probe, not
   * a workload request. Returns null on any failure so callers can handle gracefully.
   */
  async deepHealth(): Promise<AoDeepHealthResponse | null> {
    try {
      const response = await fetch(`${this.serviceUrl}/health/deep`, {
        headers: {
          'X-AO-TOKEN': this.authToken,
        },
        signal: AbortSignal.timeout(5_000),
      });
      if (!response.ok) {
        logger.warn('[AoBridge] deepHealth returned non-OK status', { status: response.status });
        return null;
      }
      return await response.json() as AoDeepHealthResponse;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn('[AoBridge] deepHealth failed', { error: msg });
      return null;
    }
  }

  private getCircuitState(repo: string): { failures: number; openUntil: number } {
    if (!this.circuitState.has(repo)) {
      this.circuitState.set(repo, { failures: 0, openUntil: 0 });
    }
    return this.circuitState.get(repo)!;
  }

  isCircuitOpen(repo?: string): boolean {
    if (!repo) return false;
    const state = this.getCircuitState(repo);
    if (state.failures >= CIRCUIT_THRESHOLD && Date.now() < state.openUntil) {
      return true;
    }
    // Auto-reset if the circuit was open and the reset window has passed
    if (state.openUntil > 0 && Date.now() >= state.openUntil) {
      state.failures = 0;
      state.openUntil = 0;
    }
    return false;
  }

  private recordFailure(repo: string): void {
    const state = this.getCircuitState(repo);
    state.failures++;
    if (state.failures >= CIRCUIT_THRESHOLD) {
      const justOpened = state.openUntil === 0;
      state.openUntil = Date.now() + CIRCUIT_RESET_MS;
      if (justOpened) {
        logger.error(`[AoBridge] circuit OPEN for ${repo} — ${CIRCUIT_THRESHOLD} consecutive failures, reset in ${CIRCUIT_RESET_MS / 1000}s`);
        this.circuitChangeCallback?.(repo, true);
      }
    }
  }

  private recordSuccess(repo: string): void {
    const state = this.getCircuitState(repo);
    const wasOpen = state.openUntil > 0 && state.failures >= CIRCUIT_THRESHOLD;
    state.failures = 0;
    state.openUntil = 0;
    if (wasOpen) {
      logger.info(`[AoBridge] circuit CLOSED for ${repo} — service recovered`);
      this.circuitChangeCallback?.(repo, false);
    }
  }

  private audit(
    action: string,
    outcome: string,
    request: AoSpawnRequest | AoBatchSpawnRequest,
    meta: Record<string, unknown>,
  ): void {
    try {
      const db = this.auditLog.getDb();
      if (!db) return;
      db.collection('audit_log').insertOne({
        agent: 'ao-bridge',
        action,
        outcome,
        request,
        meta,
        timestamp: new Date().toISOString(),
      }).catch((err: unknown) => {
        logger.warn('[AoBridge] audit write failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      });
    } catch {
      // Audit is best-effort — never crash the bridge
    }
  }
}
