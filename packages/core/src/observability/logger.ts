/**
 * ILogger — Abstract logger interface.
 *
 * Wraps the existing Winston logger so it can be swapped for other
 * implementations (pino, console, structured JSON, etc.).
 *
 * The existing createLogger() function continues to work — this interface
 * is for new code that wants provider-agnostic logging.
 */

import { createLogger } from '../logging/logger.js';

export interface ILogger {
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
  debug(message: string, meta?: Record<string, unknown>): void;
}

/**
 * Create an ILogger that delegates to the existing Winston logger.
 * This is the default — preserves all existing behavior.
 */
export function createAbstractLogger(module: string): ILogger {
  const winston = createLogger(module);

  return {
    info: (msg, meta) => winston.info(msg, meta ?? {}),
    warn: (msg, meta) => winston.warn(msg, meta ?? {}),
    error: (msg, meta) => winston.error(msg, meta ?? {}),
    debug: (msg, meta) => winston.debug(msg, meta ?? {}),
  };
}
