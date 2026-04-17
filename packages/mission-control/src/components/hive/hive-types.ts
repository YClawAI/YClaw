import type { Department } from '@/lib/agents';

export type ViewMode = '2d' | '3d';

/** Node in the Hive force graph */
export interface HiveNode {
  id: string;
  type: 'agent' | 'department' | 'external' | 'orchestrator';
  department: Department;
  label: string;
  emoji?: string;
  role?: string;
  description?: string;
  /** External node fields */
  color?: string;
  category?: string;
  // d3 simulation fields (added at runtime)
  x?: number;
  y?: number;
  z?: number;
  vx?: number;
  vy?: number;
  fx?: number | undefined;
  fy?: number | undefined;
  fz?: number | undefined;
}

/** Link between department anchor and agent node */
export interface HiveLink {
  source: string;
  target: string;
}

/**
 * Department hex colors for canvas + WebGL rendering.
 * Matches the SpaceX `mc-dept-*` tokens in tailwind.config.ts — see
 * DESIGN-SYSTEM.md for the remap. Kept as raw hex (not CSS var refs)
 * because canvas 2D and three.js materials need concrete values.
 */
export const DEPT_HEX: Record<Department, string> = {
  executive: '#FFD60A',   // mc-dept-executive (was #5AC8FA mc-accent)
  development: '#5AC8FA', // mc-dept-development (was #64D2FF mc-info)
  marketing: '#FF9F0A',   // mc-dept-marketing (was #FF9F0A mc-blocked)
  operations: '#30D158',  // mc-dept-operations (was #30D158 mc-success)
  finance: '#BF5AF2',     // mc-dept-finance (was #5AC8FA mc-accent)
  support: '#64D2FF',     // mc-dept-support (was #FFD60A mc-warning)
};

/**
 * Department anchor positions in graph space (hexagonal layout).
 * These serve as gravity wells that cluster agents by department.
 */
export const DEPT_ANCHOR_POS: Record<Department, [number, number]> = {
  executive:   [0,    -150],  // top center
  development: [130,  -75],   // top right
  marketing:   [130,   75],   // bottom right
  operations:  [0,     150],  // bottom center
  finance:     [-130,  75],   // bottom left
  support:     [-130, -75],   // top left
};

/** Convert hex color + alpha (0-1) to rgba string */
export function hexAlpha(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

// ── Event Types ─────────────────────────────────

export type HiveEventCategory =
  // Inter-agent
  | 'pr' | 'content' | 'task' | 'alert' | 'directive' | 'heartbeat'
  // External outbound (agent → service)
  | 'github_outbound' | 'twitter_outbound' | 'slack_outbound'
  | 'web_outbound' | 'figma_outbound' | 'api_outbound' | 'llm_call'
  // External inbound (service → agent)
  | 'github_inbound' | 'twitter_inbound' | 'slack_inbound' | 'web_inbound'
  // OpenClaw interactions
  | 'openclaw_trigger' | 'openclaw_directive' | 'openclaw_response';

export interface HiveEvent {
  id: string;
  type: string;                  // e.g. "pr.merged", "github.pr_opened"
  category: HiveEventCategory;
  source: string;                // agent name OR 'ext:openclaw', 'ext:github', etc.
  target: string;                // agent name OR 'ext:github', etc. OR '*'
  timestamp: number;             // epoch ms
  service?: string;              // 'github' | 'twitter' | 'slack' | etc.
  direction?: 'inbound' | 'outbound' | 'internal';
  detail?: string;               // 'PR #341 opened', 'tweeted: ...'
}

export const EVENT_CATEGORY_COLORS: Record<HiveEventCategory, string> = {
  // Inter-agent
  pr: '#a855f7',
  content: '#22c55e',
  task: '#f59e0b',
  alert: '#ef4444',
  directive: '#fbbf24',
  heartbeat: '#6b7280',
  // External outbound (cooler, dimmer)
  github_outbound: '#8b5cf6',
  twitter_outbound: '#1d9bf0',
  slack_outbound: '#e01e5a',
  web_outbound: '#6b7280',
  figma_outbound: '#a259ff',
  api_outbound: '#94a3b8',
  llm_call: '#f59e0b',
  // External inbound (warmer, brighter)
  github_inbound: '#a78bfa',
  twitter_inbound: '#38bdf8',
  slack_inbound: '#f472b6',
  web_inbound: '#9ca3af',
  // OpenClaw (red family)
  openclaw_trigger: '#ef4444',
  openclaw_directive: '#f97316',
  openclaw_response: '#fb923c',
};

/** Speed in graph-space pixels per frame at 60fps */
export const EVENT_CATEGORY_SPEEDS: Record<HiveEventCategory, number> = {
  // Inter-agent
  pr: 2.0,
  content: 1.8,
  task: 1.5,
  alert: 4.0,
  directive: 2.5,
  heartbeat: 0.5,
  // External (slightly slower — longer visual path)
  github_outbound: 1.5, twitter_outbound: 1.5, slack_outbound: 1.8,
  web_outbound: 1.2, figma_outbound: 1.3, api_outbound: 1.4, llm_call: 2.0,
  github_inbound: 1.8, twitter_inbound: 1.8, slack_inbound: 2.0, web_inbound: 1.5,
  // OpenClaw
  openclaw_trigger: 2.5, openclaw_directive: 2.0, openclaw_response: 1.8,
};

export const EVENT_CATEGORY_GLOW: Record<HiveEventCategory, number> = {
  // Inter-agent
  pr: 6, content: 5, task: 5, alert: 8, directive: 7, heartbeat: 3,
  // External
  github_outbound: 5, twitter_outbound: 5, slack_outbound: 5,
  web_outbound: 4, figma_outbound: 5, api_outbound: 4, llm_call: 4,
  github_inbound: 6, twitter_inbound: 6, slack_inbound: 6, web_inbound: 4,
  // OpenClaw
  openclaw_trigger: 7, openclaw_directive: 7, openclaw_response: 5,
};

// ── Particle System ─────────────────────────────

export interface Particle {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  category: HiveEventCategory;
  color: string;
  speed: number;              // progress (0→1) increment per frame
  progress: number;           // 0 → 1 along bezier curve
  trail: Array<{ x: number; y: number; alpha: number }>;
  glowRadius: number;
  alive: boolean;
  // Quadratic bezier: P(t) = (1-t)²·p0 + 2(1-t)t·cp + t²·p2
  p0: { x: number; y: number };
  cp: { x: number; y: number };  // control point
  p2: { x: number; y: number };
}

// ── Big Moment Overlays ──────────────────────────

export type BigMomentType = 'starburst' | 'ripple' | 'goldPulse' | 'errorFlash' | 'openclawPulse';

export interface BigMoment {
  type: BigMomentType;
  originX: number;
  originY: number;
  color: string;
  startTime: number;          // performance.now()
  duration: number;           // ms
  alive: boolean;
  targetNodes?: Array<{ x: number; y: number }>;  // for starburst
}

// ── Agent Status (enhanced for Phase 2) ─────────────

export type AgentRunState = 'idle' | 'running' | 'error' | 'paused';

export interface AgentRealtimeStatus {
  agentName: string;
  state: AgentRunState;
  execCount5m: number;        // rolling 5-min execution count
  lastRunAt: number | null;
  lastSuccessAt: number;      // for success flash
  lastErrorAt: number;        // for error shake
}

// ── Fleet / Org Settings ────────────────────────

export type FleetMode = 'active' | 'paused';
export type DeployMode = 'auto' | 'review' | 'lockdown';

export interface FleetStatus {
  mode: FleetMode;
  defaultModel: string;
  fallbackModel: string;
  deployMode: DeployMode;
  flags: Record<string, boolean>;
}

// ── Org File (GitHub-backed) ────────────────────

export interface OrgFileResponse {
  filename: string;
  content: string;
  sha: string;                // GitHub blob SHA (needed for updates)
  path: string;
  agentProtected: boolean;    // agents can't self-modify, but humans CAN edit
}

export interface OrgFileSaveRequest {
  content: string;
  sha: string;                // optimistic concurrency control
  message?: string;           // commit message
}
