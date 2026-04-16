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

export const DEPT_COLORS: Record<Department, string> = {
  executive: 'text-terminal-cyan',
  development: 'text-terminal-blue',
  marketing: 'text-terminal-orange',
  operations: 'text-terminal-green',
  finance: 'text-terminal-purple',
  support: 'text-terminal-yellow',
};

export const DEPT_BG_COLORS: Record<Department, string> = {
  executive: 'bg-terminal-cyan/10 border-terminal-cyan/30',
  development: 'bg-terminal-blue/10 border-terminal-blue/30',
  marketing: 'bg-terminal-orange/10 border-terminal-orange/30',
  operations: 'bg-terminal-green/10 border-terminal-green/30',
  finance: 'bg-terminal-purple/10 border-terminal-purple/30',
  support: 'bg-terminal-yellow/10 border-terminal-yellow/30',
};

export const DEPT_BORDER_COLORS: Record<Department, string> = {
  executive: 'border-terminal-cyan',
  development: 'border-terminal-blue',
  marketing: 'border-terminal-orange',
  operations: 'border-terminal-green',
  finance: 'border-terminal-purple',
  support: 'border-terminal-yellow',
};

// ─── SpaceX mc-* dept variants (Phase 2+) ──────────────────────────────
// Consumed by files that have been migrated to the SpaceX palette. The
// terminal-* variants above remain for un-migrated consumers and are
// deleted in Phase 6 once every file has flipped. See DESIGN-SYSTEM.md
// for the department color remap (purple → cyan brand pivot).
// ────────────────────────────────────────────────────────────────────

export const DEPT_COLORS_MC: Record<Department, string> = {
  executive: 'text-mc-dept-executive',
  development: 'text-mc-dept-development',
  marketing: 'text-mc-dept-marketing',
  operations: 'text-mc-dept-operations',
  finance: 'text-mc-dept-finance',
  support: 'text-mc-dept-support',
};

export const DEPT_BG_COLORS_MC: Record<Department, string> = {
  executive: 'bg-mc-dept-executive/10 border-mc-dept-executive/30',
  development: 'bg-mc-dept-development/10 border-mc-dept-development/30',
  marketing: 'bg-mc-dept-marketing/10 border-mc-dept-marketing/30',
  operations: 'bg-mc-dept-operations/10 border-mc-dept-operations/30',
  finance: 'bg-mc-dept-finance/10 border-mc-dept-finance/30',
  support: 'bg-mc-dept-support/10 border-mc-dept-support/30',
};

export const DEPT_BORDER_COLORS_MC: Record<Department, string> = {
  executive: 'border-mc-dept-executive',
  development: 'border-mc-dept-development',
  marketing: 'border-mc-dept-marketing',
  operations: 'border-mc-dept-operations',
  finance: 'border-mc-dept-finance',
  support: 'border-mc-dept-support',
};

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
