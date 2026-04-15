/**
 * Shared types and constants for Discord executor modules.
 */

export interface WebhookCredentials {
  id: string;
  token: string;
}

/** Departments that support webhook-based routing. */
export const WEBHOOK_DEPARTMENTS = [
  'executive', 'development', 'operations', 'marketing',
  'finance', 'support', 'audit', 'alerts', 'general',
] as const;

export type WebhookDepartment = typeof WEBHOOK_DEPARTMENTS[number];

/** Discord's native per-message character limit for public channels. */
export const PUBLIC_MESSAGE_MAX_LEN = 2000;

export const DEFAULT_HISTORY_LIMIT = 50;
export const MAX_HISTORY_LIMIT = 100;
