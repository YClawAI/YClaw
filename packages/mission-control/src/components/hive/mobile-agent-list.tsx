'use client';

import { useEffect, useState } from 'react';
import type { AgentRealtimeStatus } from './hive-types';
import { MobileAgentCard } from './mobile-agent-card';

const DEPARTMENTS = [
  { id: 'executive', label: 'Executive', agents: ['strategist', 'reviewer'] },
  { id: 'development', label: 'Development', agents: ['architect', 'builder', 'deployer', 'designer'] },
  { id: 'marketing', label: 'Marketing', agents: ['ember', 'forge', 'scout'] },
  { id: 'operations', label: 'Operations', agents: ['sentinel'] },
  { id: 'finance', label: 'Finance', agents: ['treasurer'] },
  { id: 'support', label: 'Support', agents: ['guide', 'keeper'] },
];

interface MobileAgentListProps {
  agentStatusRef: React.MutableRefObject<Map<string, AgentRealtimeStatus>>;
  onAgentTap: (agentName: string) => void;
}

export function MobileAgentList({ agentStatusRef, onAgentTap }: MobileAgentListProps) {
  const [statuses, setStatuses] = useState<Map<string, AgentRealtimeStatus>>(() => new Map(agentStatusRef.current));
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  // Poll agentStatusRef every 2s to refresh cards
  useEffect(() => {
    // Seed immediately on mount
    setStatuses(new Map(agentStatusRef.current));
    const interval = setInterval(() => {
      setStatuses(new Map(agentStatusRef.current));
    }, 2000);
    return () => clearInterval(interval);
  }, [agentStatusRef]);

  const toggleDept = (deptId: string) => {
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(deptId)) next.delete(deptId);
      else next.add(deptId);
      return next;
    });
  };

  return (
    <div className="h-full overflow-y-auto pb-20 px-3 pt-3">
      {DEPARTMENTS.map(dept => (
        <div key={dept.id} className="mb-3">
          <button
            onClick={() => toggleDept(dept.id)}
            className="w-full flex items-center justify-between px-3 py-2 rounded-chip border border-mc-border bg-transparent font-sans text-sm font-medium text-mc-text-secondary hover:border-mc-border-hover hover:text-mc-text transition-colors duration-mc ease-mc-out"
          >
            <span>{dept.label}</span>
            <span className="font-mono tabular-nums text-xs text-mc-text-tertiary">
              {dept.agents.length} agents
              {collapsed.has(dept.id) ? ' \u25B8' : ' \u25BE'}
            </span>
          </button>
          {!collapsed.has(dept.id) && (
            <div className="mt-1 space-y-1">
              {dept.agents.map(agentName => (
                <MobileAgentCard
                  key={agentName}
                  agentName={agentName}
                  status={statuses.get(agentName)}
                  onTap={() => onAgentTap(agentName)}
                />
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
