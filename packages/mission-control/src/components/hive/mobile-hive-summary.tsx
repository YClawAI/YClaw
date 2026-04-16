'use client';

import { AGENTS, DEPARTMENTS, DEPT_META, getAgentsByDept } from '@/lib/agents';
import type { AgentRealtimeStatus } from './hive-types';

interface MobileHiveSummaryProps {
  agentStatusRef: React.MutableRefObject<Map<string, AgentRealtimeStatus>>;
}

export function MobileHiveSummary({ agentStatusRef }: MobileHiveSummaryProps) {
  const statuses = agentStatusRef.current;
  const onlineCount = statuses
    ? Array.from(statuses.values()).filter(s => s.state === 'idle' || s.state === 'running').length
    : 0;

  return (
    <div className="px-4 pt-4 space-y-4">
      {/* Fleet Status */}
      <div className="border border-mc-border rounded-panel bg-transparent p-4 transition-colors duration-mc ease-mc-out hover:border-mc-border-hover">
        <div className="font-sans text-[10px] font-medium uppercase tracking-label text-mc-text-label mb-1">
          Fleet Status
        </div>
        <div className="font-mono tabular-nums text-2xl text-mc-text">
          {onlineCount} <span className="font-sans font-extralight text-sm text-mc-text-secondary">/ {AGENTS.length} online</span>
        </div>
      </div>

      {/* Department Breakdown */}
      <div className="space-y-2">
        <div className="font-sans text-[10px] font-medium uppercase tracking-label text-mc-text-label">
          Departments
        </div>
        {DEPARTMENTS.map(dept => {
          const meta = DEPT_META[dept];
          const agents = getAgentsByDept(dept);
          const deptOnline = agents.filter(a => {
            const s = statuses?.get(a.name);
            return s?.state === 'idle' || s?.state === 'running';
          }).length;
          return (
            <a
              key={dept}
              href={`/departments/${dept}`}
              className="flex items-center justify-between p-3 border border-mc-border rounded-panel bg-transparent hover:border-mc-border-hover hover:bg-mc-surface-hover transition-colors duration-mc ease-mc-out"
            >
              <div className="flex items-center gap-2">
                <span className="text-sm">{meta?.icon ?? '◇'}</span>
                <span className="font-sans text-sm text-mc-text capitalize">{meta?.label ?? dept}</span>
              </div>
              <div className="font-mono tabular-nums text-xs text-mc-text-secondary">
                {deptOnline}/{agents.length}
              </div>
            </a>
          );
        })}
      </div>
    </div>
  );
}
