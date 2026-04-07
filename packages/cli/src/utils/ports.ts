/**
 * Centralized host port resolution.
 * Single source of truth for API and Mission Control ports,
 * consumed by deploy, doctor, verification, bootstrap, and plan output.
 *
 * Priority: process.env > config > defaults
 */

import type { CliConfig } from '../types.js';

/** Resolve the host-side API port. */
export function resolveApiPort(config?: CliConfig): string {
  return process.env.API_PORT
    ?? String(config?.networking?.apiPort ?? 3000);
}

/** Resolve the host-side Mission Control port. */
export function resolveMcPort(): string {
  return process.env.MC_PORT ?? '3001';
}
