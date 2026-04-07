/**
 * Correlation ID propagation.
 *
 * Every request, event, and task should carry a correlationId that flows
 * through the entire system for end-to-end tracing.
 *
 * The system already uses correlationIds in events and tasks. This module
 * provides utilities for generating, propagating, and extracting them.
 */

import { randomUUID } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';

// ─── Async Context for Correlation ID ───────────────────────────────────────

const correlationStorage = new AsyncLocalStorage<string>();

/**
 * Get the current correlation ID from async context.
 * Returns undefined if no correlation context is active.
 */
export function getCorrelationId(): string | undefined {
  return correlationStorage.getStore();
}

/**
 * Run a function within a correlation context.
 * All code executed within the callback can access the correlation ID
 * via getCorrelationId().
 *
 * @param correlationId - The correlation ID to propagate
 * @param fn - The function to execute within the correlation context
 */
export function withCorrelationId<T>(correlationId: string, fn: () => T): T {
  return correlationStorage.run(correlationId, fn);
}

/**
 * Generate a new correlation ID.
 * Format: UUID v4 (consistent with existing usage in the codebase).
 */
export function generateCorrelationId(): string {
  return randomUUID();
}

/**
 * Extract a correlation ID from an event payload, request headers,
 * or other source. Returns a new ID if none is found.
 */
export function extractOrGenerateCorrelationId(
  source?: { correlationId?: string; correlation_id?: string; headers?: Record<string, string> },
): string {
  if (source?.correlationId) return source.correlationId;
  if (source?.correlation_id) return source.correlation_id;
  if (source?.headers?.['x-correlation-id']) return source.headers['x-correlation-id'];
  return generateCorrelationId();
}
