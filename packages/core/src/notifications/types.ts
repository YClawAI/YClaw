/**
 * Shared notification event types — platform-agnostic.
 *
 * These types define the unified event model that both Slack and Discord
 * renderers consume. Agent code emits NotificationEvents through the
 * NotificationRouter; each platform renderer transforms them into
 * platform-specific formats (Block Kit, embeds, markdown, etc.).
 */

// ─── Enums ───────────────────────────────────────────────────────────────────

export type NotificationKind =
  | 'lifecycle'      // task requested/started/completed/failed
  | 'heartbeat'      // agent heartbeat/standup
  | 'pr_status'      // PR opened/approved/merged/closed
  | 'ci_status'      // CI pass/fail/pending
  | 'alert'          // P0/P1 incidents, circuit breakers
  | 'deployment'     // deploy started/succeeded/failed
  | 'wallet_update'  // balance changes, tx alerts
  | 'audit_log'      // self-modification, security events
  | 'moderation'     // community mod actions
  | 'standup'        // daily agent standup summaries
  | 'support'        // escalated tickets
  | 'metric';        // periodic metrics/analytics

export type Severity = 'info' | 'success' | 'warning' | 'error' | 'critical';

export type Department =
  | 'executive' | 'development' | 'operations' | 'alerts'
  | 'marketing' | 'finance' | 'audit' | 'support' | 'general';

// ─── Notification Event ──────────────────────────────────────────────────────

export interface NotificationEvent {
  kind: NotificationKind;
  severity: Severity;
  title: string;
  summary: string;
  agent: {
    id: string;
    name: string;
    emoji: string;
    department: Department;
  };
  fields?: Array<{ name: string; value: string; inline?: boolean }>;
  links?: Array<{ label: string; url: string }>;
  /** Correlation key for thread grouping (e.g. "pr-123", "incident-INC-42"). */
  threadKey?: string;
  metadata?: Record<string, unknown>;
  timestamp: Date;
  /** User/role IDs to mention (platform-specific). */
  mentions?: string[];
}

// ─── Publish Result ──────────────────────────────────────────────────────────

export interface PublishResult {
  messageId: string;
  threadId?: string;
  platform: string;
}
