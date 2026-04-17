import { fetchPublicApi } from '@/lib/api';
import type { PublicStatus, PublicDepartment } from '@/lib/api';

function StatCard({ label, value, color }: { label: string; value: string | number; color: string }) {
  return (
    <div className="bg-mc-surface-hover border border-mc-border rounded-lg p-5">
      <p className="text-sm text-mc-text-tertiary mb-1">{label}</p>
      <p className={`text-3xl font-bold ${color}`}>{value}</p>
    </div>
  );
}

function Skeleton() {
  return <div className="bg-mc-border/30 rounded animate-pulse h-24" />;
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
        <h1 className="text-2xl font-bold text-mc-text mb-2">System Dashboard</h1>
        <p className="text-mc-text-tertiary">Real-time overview of the YCLAW agent system</p>
      </div>

      {status ? (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <StatCard
            label="System Status"
            value={status.status === 'operational' ? 'Operational' : status.status}
            color={status.status === 'operational' ? 'text-mc-success' : 'text-mc-warning'}
          />
          <StatCard label="Active Agents" value={status.activeAgents} color="text-mc-info" />
          <StatCard label="Tasks Today" value={status.totalTasksToday} color="text-mc-accent" />
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Skeleton /><Skeleton /><Skeleton />
        </div>
      )}

      <div>
        <h2 className="text-lg font-semibold text-mc-text mb-4">Departments</h2>
        {departments.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {departments.map((dept) => (
              <div
                key={dept.name}
                className="bg-mc-surface-hover border border-mc-border rounded-lg p-4 flex items-center justify-between"
              >
                <div>
                  <p className="text-mc-text font-medium capitalize">{dept.name}</p>
                  <p className="text-sm text-mc-text-tertiary">{dept.agentCount} agents</p>
                </div>
                <div className="text-right">
                  <p className="text-lg font-bold text-mc-accent">{dept.activeTaskCount}</p>
                  <p className="text-xs text-mc-text-tertiary">active tasks</p>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-mc-text-tertiary">Data unavailable</p>
        )}
      </div>
    </div>
  );
}
