/**
 * Error Taxonomy — standard error codes for operator/assistant diagnostics.
 *
 * Every error includes: what failed, category, severity, and a suggested action.
 * These codes are pure data (zero imports) so any layer can reference them
 * without circular dependencies.
 */

export type ErrorSeverity = 'critical' | 'warning' | 'info';
export type ErrorCategory = 'infra' | 'llm' | 'agent' | 'security' | 'channel';

export interface ErrorCodeEntry {
  category: ErrorCategory;
  severity: ErrorSeverity;
  action: string;
}

export const ERROR_CODES = {
  // ─── Infrastructure ──────────────────────────────────────────────────────
  STATE_STORE_UNREACHABLE: {
    category: 'infra',
    severity: 'critical',
    action: 'Check database connection',
  },
  EVENT_BUS_UNREACHABLE: {
    category: 'infra',
    severity: 'critical',
    action: 'Check Redis connection',
  },
  MEMORY_STORE_UNREACHABLE: {
    category: 'infra',
    severity: 'warning',
    action: 'Memory system degraded, agents run without long-term memory',
  },
  OBJECT_STORE_UNREACHABLE: {
    category: 'infra',
    severity: 'warning',
    action: 'Check object store configuration',
  },

  // ─── LLM ─────────────────────────────────────────────────────────────────
  LLM_TIMEOUT: {
    category: 'llm',
    severity: 'warning',
    action: 'Retry or switch provider',
  },
  LLM_RATE_LIMITED: {
    category: 'llm',
    severity: 'warning',
    action: 'Wait or reduce concurrency',
  },
  LLM_AUTH_FAILED: {
    category: 'llm',
    severity: 'critical',
    action: 'Check API key',
  },
  LLM_CONTEXT_OVERFLOW: {
    category: 'llm',
    severity: 'warning',
    action: 'Reduce input size or switch to a model with larger context',
  },

  // ─── Agent ───────────────────────────────────────────────────────────────
  AGENT_TASK_FAILED: {
    category: 'agent',
    severity: 'warning',
    action: 'Check task logs',
  },
  AGENT_CHECKPOINT_STALE: {
    category: 'agent',
    severity: 'info',
    action: 'Task may have been interrupted',
  },
  AGENT_BUDGET_EXCEEDED: {
    category: 'agent',
    severity: 'warning',
    action: 'Review agent budget config',
  },
  AGENT_NOT_FOUND: {
    category: 'agent',
    severity: 'warning',
    action: 'Check agent configuration and department assignments',
  },

  // ─── Security ────────────────────────────────────────────────────────────
  EVENT_SIGNATURE_INVALID: {
    category: 'security',
    severity: 'critical',
    action: 'Possible event forgery attempt',
  },
  OPERATOR_AUTH_FAILED: {
    category: 'security',
    severity: 'warning',
    action: 'Check operator API key',
  },
  PERMISSION_DENIED: {
    category: 'security',
    severity: 'info',
    action: 'Operator lacks required permission',
  },

  // ─── Channel ─────────────────────────────────────────────────────────────
  CHANNEL_DISCONNECTED: {
    category: 'channel',
    severity: 'warning',
    action: 'Check channel credentials and connectivity',
  },
  CHANNEL_RATE_LIMITED: {
    category: 'channel',
    severity: 'info',
    action: 'Wait for rate limit reset',
  },
} as const satisfies Record<string, ErrorCodeEntry>;

export type ErrorCode = keyof typeof ERROR_CODES;

/**
 * Look up an error code entry. Returns undefined for unknown codes.
 */
export function getErrorCode(code: string): ErrorCodeEntry | undefined {
  return (ERROR_CODES as Record<string, ErrorCodeEntry>)[code];
}

/**
 * Get all error codes for a given category.
 */
export function getErrorCodesByCategory(category: ErrorCategory): Array<{ code: ErrorCode; entry: ErrorCodeEntry }> {
  return (Object.entries(ERROR_CODES) as Array<[ErrorCode, ErrorCodeEntry]>)
    .filter(([, entry]) => entry.category === category)
    .map(([code, entry]) => ({ code, entry }));
}

/**
 * Get all error codes at a given severity level or above.
 */
export function getErrorCodesBySeverity(minSeverity: ErrorSeverity): Array<{ code: ErrorCode; entry: ErrorCodeEntry }> {
  const severityOrder: ErrorSeverity[] = ['info', 'warning', 'critical'];
  const minIndex = severityOrder.indexOf(minSeverity);
  return (Object.entries(ERROR_CODES) as Array<[ErrorCode, ErrorCodeEntry]>)
    .filter(([, entry]) => severityOrder.indexOf(entry.severity) >= minIndex)
    .map(([code, entry]) => ({ code, entry }));
}
