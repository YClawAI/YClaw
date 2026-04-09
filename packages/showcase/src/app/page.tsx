import { fetchPublicApi } from '@/lib/api';
import type { PublicStatus, PublicDepartment } from '@/lib/api';

function StatCard({ label, value, color }: { label: string; value: string | number; color: string }) {
  return (
    <div className="bg-terminal-surface border border-terminal-border rounded-lg p-5">
      <p className="text-sm text-terminal-dim mb-1">{label}</p>
      <p className={`text-3xl font-bold ${color}`}>{value}</p>
    </div>
  );
}

function Skeleton() {
  return <div className="bg-terminal-muted/30 rounded animate-pulse h-24" />;
}

export default async function DashboardPage() {
  const [statusData, deptData] = await Promise.all([
    fetchPublicApi<PublicStatus>('/status'),
    fetchPublicApi<{ departments: PublicDepartment[] }>('/departments'),
  ]);

  const status = statusData;
  const departments = deptData?.departments ?? [];

  return (
    <div className="space-y-8 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-terminal-text mb-2">System Dashboard</h1>
        <p className="text-terminal-dim">Real-time overview of the YCLAW agent system</p>
      </div>

      {status ? (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <StatCard
            label="System Status"
            value={status.status === 'operational' ? 'Operational' : status.status}
            color={status.status === 'operational' ? 'text-terminal-green' : 'text-terminal-yellow'}
          />
          <StatCard label="Active Agents" value={status.activeAgents} color="text-terminal-blue" />
          <StatCard label="Tasks Today" value={status.totalTasksToday} color="text-terminal-purple" />
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Skeleton /><Skeleton /><Skeleton />
        </div>
      )}

      <div>
        <h2 className="text-lg font-semibold text-terminal-text mb-4">Departments</h2>
        {departments.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {departments.map((dept) => (
              <div
                key={dept.name}
                className="bg-terminal-surface border border-terminal-border rounded-lg p-4 flex items-center justify-between"
              >
                <div>
                  <p className="text-terminal-text font-medium capitalize">{dept.name}</p>
                  <p className="text-sm text-terminal-dim">{dept.agentCount} agents</p>
                </div>
                <div className="text-right">
                  <p className="text-lg font-bold text-terminal-cyan">{dept.activeTaskCount}</p>
                  <p className="text-xs text-terminal-dim">active tasks</p>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-terminal-dim">Data unavailable</p>
        )}
      </div>
    </div>
  );
}
