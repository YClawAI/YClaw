'use client';

interface SystemStatsProps {
  agents: { total: number; active: number; idle: number; errored: number };
  tasks: { pending: number; running: number; failedLast24h: number };
}

export function SystemStats({ agents, tasks }: SystemStatsProps) {
  return (
    <div className="grid grid-cols-2 gap-4">
      {/* Agents */}
      <div>
        <h4 className="text-xs font-bold uppercase tracking-widest text-mc-text-tertiary mb-2">
          Agents
        </h4>
        <div className="space-y-1 text-xs font-mono">
          <StatRow label="Active" value={agents.active} color="text-mc-success" />
          <StatRow label="Idle" value={agents.idle} color="text-mc-text-tertiary" />
          <StatRow label="Errored" value={agents.errored} color={agents.errored > 0 ? 'text-mc-danger' : 'text-mc-text-tertiary'} />
          <div className="border-t border-mc-border pt-1 mt-1">
            <StatRow label="Total" value={agents.total} color="text-mc-text" />
          </div>
        </div>
      </div>

      {/* Tasks */}
      <div>
        <h4 className="text-xs font-bold uppercase tracking-widest text-mc-text-tertiary mb-2">
          Tasks
        </h4>
        <div className="space-y-1 text-xs font-mono">
          <StatRow label="Pending" value={tasks.pending} color="text-mc-blocked" />
          <StatRow label="Running" value={tasks.running} color="text-mc-accent" />
          <StatRow label="Failed (24h)" value={tasks.failedLast24h} color={tasks.failedLast24h > 0 ? 'text-mc-danger' : 'text-mc-text-tertiary'} />
        </div>
      </div>
    </div>
  );
}

function StatRow({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-mc-text-tertiary">{label}</span>
      <span className={color}>{value}</span>
    </div>
  );
}
