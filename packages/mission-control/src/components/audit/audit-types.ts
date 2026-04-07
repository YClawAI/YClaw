export type AuditEventType =
  | 'setting_change'
  | 'deploy'
  | 'agent_error'
  | 'agent_action'
  | 'budget_alert'
  | 'governance';

export type AuditSeverity = 'info' | 'warning' | 'critical';

export type AuditActor = 'agent' | 'human' | 'system';

export interface AuditEvent {
  id: string;
  timestamp: string;
  type: AuditEventType;
  severity: AuditSeverity;
  agentId?: string;
  department?: string;
  title: string;
  detail?: string;
  metadata?: Record<string, unknown>;
  actor: AuditActor;
}

export const AUDIT_TYPE_CONFIG: Record<AuditEventType, {
  icon: string;
  color: string;
  label: string;
}> = {
  setting_change: { icon: '\u2699\uFE0F', color: 'text-gray-400', label: 'Setting' },
  deploy:         { icon: '\u{1F680}', color: 'text-green-400', label: 'Deploy' },
  agent_error:    { icon: '\u{1F534}', color: 'text-red-400', label: 'Error' },
  agent_action:   { icon: '\u2B50', color: 'text-amber-400', label: 'Action' },
  budget_alert:   { icon: '\u{1F4B0}', color: 'text-yellow-400', label: 'Budget' },
  governance:     { icon: '\u{1F6E1}\uFE0F', color: 'text-purple-400', label: 'Governance' },
};

export const SEVERITY_COLORS: Record<AuditSeverity, string> = {
  info: 'border-l-gray-600',
  warning: 'border-l-yellow-500',
  critical: 'border-l-red-500',
};

export interface AuditFilters {
  types: AuditEventType[];
  agentIds: string[];
  severities: AuditSeverity[];
  search: string;
  timeRange: '24h' | '7d' | '30d';
}

export const DEFAULT_FILTERS: AuditFilters = {
  types: [],
  agentIds: [],
  severities: [],
  search: '',
  timeRange: '24h',
};
