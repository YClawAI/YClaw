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
        <h4 className="text-xs font-bold uppercase tracking-widest text-terminal-dim mb-2">
          Agents
        </h4>
        <div className="space-y-1 text-xs font-mono">
          <StatRow label="Active" value={agents.active} color="text-terminal-green" />
          <StatRow label="Idle" value={agents.idle} color="text-terminal-dim" />
          <StatRow label="Errored" value={agents.errored} color={agents.errored > 0 ? 'text-terminal-red' : 'text-terminal-dim'} />
          <div className="border-t border-terminal-border pt-1 mt-1">
            <StatRow label="Total" value={agents.total} color="text-terminal-text" />
          </div>
        </div>
      </div>

      {/* Tasks */}
      <div>
        <h4 className="text-xs font-bold uppercase tracking-widest text-terminal-dim mb-2">
          Tasks
        </h4>
        <div className="space-y-1 text-xs font-mono">
          <StatRow label="Pending" value={tasks.pending} color="text-terminal-orange" />
          <StatRow label="Running" value={tasks.running} color="text-terminal-cyan" />
          <StatRow label="Failed (24h)" value={tasks.failedLast24h} color={tasks.failedLast24h > 0 ? 'text-terminal-red' : 'text-terminal-dim'} />
        </div>
      </div>
    </div>
  );
}

function StatRow({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-terminal-dim">{label}</span>
      <span className={color}>{value}</span>
    </div>
  );
}
