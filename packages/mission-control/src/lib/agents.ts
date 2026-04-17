export type Department =
  | 'executive'
  | 'development'
  | 'marketing'
  | 'operations'
  | 'finance'
  | 'support';

export type AgentSystem = 'yclaw' | 'openclaw' | 'both';

export interface AgentInfo {
  name: string;
  department: Department;
  label: string;
  description: string;
  system: AgentSystem;
  emoji?: string;
  model?: string;
  role?: string;
}

export interface DeptMeta {
  key: Department;
  label: string;
  icon: string;
  lead: string;
  description: string;
}

export const AGENTS: AgentInfo[] = [
  { name: 'strategist', department: 'executive', label: 'Strategist', description: 'High-level planning and coordination', system: 'both', emoji: '🧠', role: 'lead' },
  { name: 'reviewer', department: 'executive', label: 'Reviewer', description: 'Brand compliance and quality gate', system: 'both', emoji: '🔍' },
  { name: 'architect', department: 'development', label: 'Architect', description: 'System design and code review', system: 'yclaw', emoji: '🏗️', role: 'lead' },
  { name: 'designer', department: 'development', label: 'Designer', description: 'UI/UX and design system', system: 'yclaw', emoji: '🎨' },
  { name: 'ember', department: 'marketing', label: 'Ember', description: 'Content creation and social media', system: 'both', emoji: '🔥', role: 'lead' },
  { name: 'forge', department: 'marketing', label: 'Forge', description: 'Visual and video asset production', system: 'yclaw', emoji: '⚒️' },
  { name: 'scout', department: 'marketing', label: 'Scout', description: 'Market research and competitive intelligence', system: 'yclaw', emoji: '🔭' },
  { name: 'sentinel', department: 'operations', label: 'Sentinel', description: 'Deploy health, code quality audits', system: 'yclaw', emoji: '🛡️', role: 'lead' },
  { name: 'treasurer', department: 'finance', label: 'Treasurer', description: 'Cost tracking and budget management', system: 'both', emoji: '💰', role: 'lead' },
  { name: 'keeper', department: 'support', label: 'Keeper', description: 'Community moderation', system: 'both', emoji: '🔧', role: 'lead' },
  { name: 'guide', department: 'support', label: 'Guide', description: 'Escalated support and troubleshooting', system: 'yclaw', emoji: '📚' },
  { name: 'librarian', department: 'operations', label: 'Librarian', description: 'Knowledge curation and vault management', system: 'yclaw', emoji: '📖' },
];

export const DEPARTMENTS: Department[] = [
  'executive',
  'development',
  'marketing',
  'operations',
  'finance',
  'support',
];

export const DEPT_META: Record<Department, DeptMeta> = {
  executive: { key: 'executive', label: 'Executive', icon: '👑', lead: 'Strategist', description: 'Org coordination, directives, compliance gate' },
  development: { key: 'development', label: 'Development', icon: '💻', lead: 'Architect', description: 'Code, PRs, architecture, deploys' },
  marketing: { key: 'marketing', label: 'Marketing', icon: '📈', lead: 'Ember', description: 'Content, research, creative assets' },
  operations: { key: 'operations', label: 'Operations', icon: '🛡️', lead: 'Sentinel', description: 'Deploy health, code quality, monitoring' },
  finance: { key: 'finance', label: 'Finance', icon: '💰', lead: 'Treasurer', description: 'Treasury monitoring, cost tracking, budget management' },
  support: { key: 'support', label: 'Support', icon: '🆘', lead: 'Keeper', description: 'Community moderation, escalated support' },
};

// ─── SpaceX mc-* dept color maps (Phase 5+) ───────────────────────────
// Canonical dept color maps now point to the SpaceX palette. The legacy
// DEPT_COLORS / DEPT_BG_COLORS / DEPT_BORDER_COLORS names and the _MC-
// suffixed names are both exported here as identical references so both
// migrated and un-migrated consumers resolve to the same mc-* strings.
// Phase 6 removes the duplicate _MC aliases.
// ────────────────────────────────────────────────────────────────────

export const DEPT_COLORS: Record<Department, string> = {
  executive: 'text-mc-dept-executive',
  development: 'text-mc-dept-development',
  marketing: 'text-mc-dept-marketing',
  operations: 'text-mc-dept-operations',
  finance: 'text-mc-dept-finance',
  support: 'text-mc-dept-support',
};

export const DEPT_BG_COLORS: Record<Department, string> = {
  executive: 'bg-mc-dept-executive/10 border-mc-dept-executive/30',
  development: 'bg-mc-dept-development/10 border-mc-dept-development/30',
  marketing: 'bg-mc-dept-marketing/10 border-mc-dept-marketing/30',
  operations: 'bg-mc-dept-operations/10 border-mc-dept-operations/30',
  finance: 'bg-mc-dept-finance/10 border-mc-dept-finance/30',
  support: 'bg-mc-dept-support/10 border-mc-dept-support/30',
};

export const DEPT_BORDER_COLORS: Record<Department, string> = {
  executive: 'border-mc-dept-executive',
  development: 'border-mc-dept-development',
  marketing: 'border-mc-dept-marketing',
  operations: 'border-mc-dept-operations',
  finance: 'border-mc-dept-finance',
  support: 'border-mc-dept-support',
};

// _MC-suffixed aliases kept during Phase 5 so files migrated in Phase 2–4
// (that imported DEPT_COLORS_MC directly) keep working without churn.
// Phase 6 deletes these aliases.
export const DEPT_COLORS_MC = DEPT_COLORS;
export const DEPT_BG_COLORS_MC = DEPT_BG_COLORS;
export const DEPT_BORDER_COLORS_MC = DEPT_BORDER_COLORS;

export function getAgent(name: string): AgentInfo | undefined {
  return AGENTS.find((a) => a.name === name);
}

export function getAgentsByDept(dept: Department): AgentInfo[] {
  return AGENTS.filter((a) => a.department === dept);
}

export function getYClawAgents(): AgentInfo[] {
  return AGENTS.filter((a) => a.system === 'yclaw' || a.system === 'both');
}

export function getOpenClawAgents(): AgentInfo[] {
  return AGENTS.filter((a) => a.system === 'openclaw' || a.system === 'both');
}
