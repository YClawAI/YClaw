import type { Department } from '@/lib/agents';
import { DEPT_META, DEPT_COLORS, getAgentsByDept } from '@/lib/agents';

interface DeptHeaderProps {
  department: Department;
  healthy?: boolean;
}

export function DeptHeader({ department, healthy = true }: DeptHeaderProps) {
  const meta = DEPT_META[department];
  const agents = getAgentsByDept(department);
  const colorClass = DEPT_COLORS[department];
  const statusDot = healthy
    ? 'bg-terminal-green shadow-[0_0_6px_#a6e3a1]'
    : 'bg-terminal-yellow shadow-[0_0_6px_#f9e2af]';

  return (
    <div className="bg-terminal-surface border border-terminal-border rounded p-4 mb-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-2xl">{meta.icon}</span>
          <div>
            <h1 className={`text-lg font-bold ${colorClass}`}>{meta.label} Department</h1>
            <p className="text-xs text-terminal-dim">
              Lead: {meta.lead} · {agents.length} agent{agents.length !== 1 ? 's' : ''}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className={`inline-block w-2.5 h-2.5 rounded-full ${statusDot}`} />
          <span className="text-xs text-terminal-dim font-mono">{healthy ? 'All Healthy' : 'Degraded'}</span>
        </div>
      </div>
    </div>
  );
}
