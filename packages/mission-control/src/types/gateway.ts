// ── Status ──────────────────────────────────────────────────────
export interface GatewayStatus {
  version: string;
  model: string;
  uptime: string;
  sessions: number;
  contextTokens: number;
  totalTokens: number;
  thinkMode: string;
  elevated: boolean;
}

// ── Channels ────────────────────────────────────────────────────
export interface ChannelStatus {
  provider: string;
  accountId?: string;
  connected: boolean;
  error?: string;
  lastMessageAt?: number;
  stats?: { sent: number; received: number };
}

// ── Sessions ────────────────────────────────────────────────────
export interface SessionInfo {
  key: string;
  kind: string;
  channel: string;
  displayName?: string;
  updatedAt: number;
  model: string;
  contextTokens: number;
  totalTokens: number;
  sessionId: string;
  lastChannel?: string;
}

// ── Cron ────────────────────────────────────────────────────────
export interface CronJob {
  id: string;
  name?: string;
  enabled: boolean;
  schedule: {
    kind: 'at' | 'every' | 'cron';
    at?: string;
    everyMs?: number;
    expr?: string;
    tz?: string;
  };
  payload: {
    kind: 'systemEvent' | 'agentTurn';
    text?: string;
    message?: string;
    model?: string;
  };
  delivery?: {
    mode: 'none' | 'announce' | 'webhook';
    channel?: string;
    to?: string;
  };
  sessionTarget: 'main' | 'isolated';
  lastRun?: { at: string; status: string; durationMs?: number };
  nextRun?: string;
}

export interface CronStatus {
  running: boolean;
  jobCount: number;
  nextRun?: string;
}

// ── Skills ──────────────────────────────────────────────────────
export interface SkillInfo {
  name: string;
  enabled: boolean;
  hasApiKey: boolean;
  hasBinary: boolean;
  description?: string;
  // Real gateway fields
  disabled?: boolean;
  eligible?: boolean;
  source?: string;
  bundled?: boolean;
  emoji?: string;
  skillKey?: string;
}

// ── Config ──────────────────────────────────────────────────────
export interface GatewayConfig {
  [key: string]: unknown;
  _baseHash?: string;
}

// ── Health ──────────────────────────────────────────────────────
export interface HealthSnapshot {
  status: 'healthy' | 'degraded' | 'down';
  checks: Array<{ name: string; status: string; message?: string }>;
}

// ── Models ──────────────────────────────────────────────────────
export interface ModelInfo {
  id: string;
  provider: string;
  alias?: string;
  available: boolean;
  // Real gateway fields
  name?: string;
  contextWindow?: number;
  reasoning?: boolean;
}

// ── Presence ────────────────────────────────────────────────────
export interface PresenceEntry {
  deviceId: string;
  roles: string[];
  scopes: string[];
  client?: { id: string; version: string; platform: string };
}
