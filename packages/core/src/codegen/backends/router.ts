import type { CodegenBackend } from './types.js';
import { ClaudeCodeBackend } from './claude.js';
import { CodexBackend } from './codex.js';
import { OpenCodeBackend } from './opencode.js';
import { createLogger } from '../../logging/logger.js';

const logger = createLogger('backend-router');

// ─── Backend Router ─────────────────────────────────────────────────────────
//
// Resolves the preferred backend from repo config.
// Falls back through priority chain: claude → codex → opencode.
//

/** Default fallback order when preferred backend is unavailable */
const FALLBACK_CHAIN: readonly string[] = ['claude', 'codex', 'opencode'];

export class BackendRouter {
  private backends = new Map<string, CodegenBackend>();
  private availabilityCache = new Map<string, { available: boolean; checkedAt: number }>();
  private static readonly CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

  constructor() {
    const claude = new ClaudeCodeBackend();
    const codex = new CodexBackend();
    const opencode = new OpenCodeBackend();

    this.backends.set(claude.name, claude);
    this.backends.set(codex.name, codex);
    this.backends.set(opencode.name, opencode);
  }

  /**
   * Resolve a backend by preference, falling back through the chain.
   * Checks availability before returning. Returns null if no backend is available.
   */
  async resolve(preferred: string): Promise<CodegenBackend | null> {
    // Try preferred first
    const preferredBackend = this.backends.get(preferred);
    if (preferredBackend) {
      const available = await this.checkAvailability(preferredBackend);
      if (available) {
        return preferredBackend;
      }
      logger.warn('Preferred backend unavailable', { preferred });
    }

    // Fall through chain
    for (const name of FALLBACK_CHAIN) {
      if (name === preferred) continue; // Already tried
      const backend = this.backends.get(name);
      if (backend) {
        const available = await this.checkAvailability(backend);
        if (available) {
          logger.info('Falling back to backend', { preferred, actual: name });
          return backend;
        }
      }
    }

    logger.error('No backends available');
    return null;
  }

  /**
   * Check if at least one backend is available.
   */
  async hasAvailableBackend(): Promise<boolean> {
    for (const backend of this.backends.values()) {
      const available = await this.checkAvailability(backend);
      if (available) return true;
    }
    return false;
  }

  /**
   * Get availability status of all backends.
   */
  async getStatus(): Promise<Record<string, boolean>> {
    const status: Record<string, boolean> = {};
    for (const [name, backend] of this.backends) {
      status[name] = await this.checkAvailability(backend);
    }
    return status;
  }

  /**
   * Check backend availability with caching.
   */
  private async checkAvailability(backend: CodegenBackend): Promise<boolean> {
    const cached = this.availabilityCache.get(backend.name);
    if (cached && Date.now() - cached.checkedAt < BackendRouter.CACHE_TTL_MS) {
      return cached.available;
    }

    try {
      const available = await backend.isAvailable();
      this.availabilityCache.set(backend.name, {
        available,
        checkedAt: Date.now(),
      });
      return available;
    } catch {
      this.availabilityCache.set(backend.name, {
        available: false,
        checkedAt: Date.now(),
      });
      return false;
    }
  }
}
