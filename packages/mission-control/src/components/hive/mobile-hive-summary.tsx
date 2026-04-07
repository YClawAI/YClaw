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
      <div className="bg-gray-800/50 rounded-lg p-4">
        <div className="text-xs text-gray-400 uppercase tracking-widest mb-1">Fleet Status</div>
        <div className="text-2xl font-bold text-white font-mono">
          {onlineCount} <span className="text-sm text-gray-400">/ {AGENTS.length} online</span>
        </div>
      </div>

      {/* Department Breakdown */}
      <div className="space-y-2">
        <div className="text-xs text-gray-400 uppercase tracking-widest">Departments</div>
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
              className="flex items-center justify-between p-3 bg-gray-800/30 rounded-lg hover:bg-gray-800/50 transition-colors"
            >
              <div className="flex items-center gap-2">
                <span className="text-sm">{meta?.icon ?? '◇'}</span>
                <span className="text-sm text-gray-200 capitalize">{meta?.label ?? dept}</span>
              </div>
              <div className="text-xs font-mono text-gray-400">
                {deptOnline}/{agents.length}
              </div>
            </a>
          );
        })}
      </div>
    </div>
  );
}
