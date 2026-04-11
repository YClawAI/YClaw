import { fetchPublicApi } from '@/lib/api';
import type { PublicAgent } from '@/lib/api';

const STATUS_COLORS: Record<string, string> = {
  running: 'bg-terminal-green',
  idle:    'bg-terminal-blue',
  error:   'bg-terminal-red',
  offline: 'bg-terminal-dim',
};

const DEPT_COLORS: Record<string, string> = {
  executive:   'text-terminal-yellow',
  development: 'text-terminal-blue',
  marketing:   'text-terminal-orange',
  finance:     'text-terminal-green',
  operations:  'text-terminal-cyan',
  support:     'text-terminal-purple',
};

export default async function AgentsPage() {
  const data = await fetchPublicApi<{ agents: PublicAgent[] }>('/agents');
  const agents = data?.agents ?? [];

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-terminal-text mb-2">Agents</h1>
        <p className="text-terminal-dim">{agents.length} agents across all departments</p>
      </div>

      {agents.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {agents.map((agent) => (
            <div
              key={agent.name}
              className="bg-terminal-surface border border-terminal-border rounded-lg p-5 space-y-3"
            >
              <div className="flex items-center justify-between">
                <h3 className="text-terminal-text font-semibold capitalize">{agent.name}</h3>
                <div className="flex items-center gap-1.5">
                  <span
                    className={`w-2 h-2 rounded-full ${STATUS_COLORS[agent.status] ?? STATUS_COLORS.offline}`}
                    aria-hidden="true"
                  />
                  <span className="text-xs text-terminal-dim capitalize">{agent.status}</span>
                </div>
              </div>
              <p className="text-sm text-terminal-dim line-clamp-2">{agent.role}</p>
              <span
                className={`text-xs font-medium capitalize ${DEPT_COLORS[agent.department] ?? 'text-terminal-dim'}`}
              >
                {agent.department}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-terminal-dim">Data unavailable</p>
      )}
    </div>
  );
}
