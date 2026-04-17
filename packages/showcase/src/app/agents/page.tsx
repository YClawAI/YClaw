import { fetchPublicApi } from '@/lib/api';
import type { PublicAgent } from '@/lib/api';

const STATUS_COLORS: Record<string, string> = {
  running: 'bg-mc-success',
  idle: 'bg-mc-info',
  error: 'bg-mc-danger',
  offline: 'bg-mc-text-tertiary',
};

const DEPT_COLORS: Record<string, string> = {
  executive: 'text-mc-warning',
  development: 'text-mc-info',
  marketing: 'text-mc-blocked',
  finance: 'text-mc-success',
  operations: 'text-mc-accent',
  support: 'text-mc-accent',
};

export default async function AgentsPage() {
  const data = await fetchPublicApi<{ agents: PublicAgent[] }>('/agents');
  const agents = data?.agents ?? [];

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-mc-text mb-2">Agents</h1>
        <p className="text-mc-text-tertiary">{agents.length} agents across all departments</p>
      </div>

      {agents.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {agents.map((agent) => (
            <div
              key={agent.name}
              className="bg-mc-surface-hover border border-mc-border rounded-lg p-5 space-y-3"
            >
              <div className="flex items-center justify-between">
                <h3 className="text-mc-text font-semibold capitalize">{agent.name}</h3>
                <div className="flex items-center gap-1.5">
                  <span className={`w-2 h-2 rounded-full ${STATUS_COLORS[agent.status] || STATUS_COLORS.offline}`} />
                  <span className="text-xs text-mc-text-tertiary capitalize">{agent.status}</span>
                </div>
              </div>
              <p className="text-sm text-mc-text-tertiary line-clamp-2">{agent.role}</p>
              <span className={`text-xs font-medium capitalize ${DEPT_COLORS[agent.department] || 'text-mc-text-tertiary'}`}>
                {agent.department}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-mc-text-tertiary">Data unavailable</p>
      )}
    </div>
  );
}
