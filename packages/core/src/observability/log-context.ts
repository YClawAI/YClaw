/**
 * LogContext — structured context fields for observability logging.
 *
 * Provides a standard shape for structured log metadata so that
 * all log entries carry consistent, queryable fields.
 */

import type { ErrorCode } from './error-codes.js';

/**
 * Standard structured log context.
 * All fields are optional — include what's available.
 */
export interface LogContext {
  correlationId?: string;
  operatorId?: string;
  agentId?: string;
  department?: string;
  taskId?: string;
  errorCode?: ErrorCode;
  durationMs?: number;
  [key: string]: unknown;
}

/**
 * Build a log metadata object from a LogContext.
 * Strips undefined values so Winston/JSON.stringify produces clean output.
 */
export function buildLogMeta(ctx: LogContext): Record<string, unknown> {
  const meta: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(ctx)) {
    if (value !== undefined) {
      meta[key] = value;
    }
  }
  return meta;
}
