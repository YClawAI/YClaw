import { fetchPublicApi } from '@/lib/api';
import type { PublicQueueStats } from '@/lib/api';

function QueueBar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-sm text-terminal-dim">{label}</span>
        <span className={`text-lg font-bold ${color}`}>{value}</span>
      </div>
      <div className="h-2 bg-terminal-muted rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color.replace('text-', 'bg-')}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export default async function QueuePage() {
  const stats = await fetchPublicApi<PublicQueueStats>('/queue/stats');

  const total = stats ? stats.pending + stats.running + stats.completed24h + stats.failed24h : 0;

  return (
    <div className="space-y-8 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-terminal-text mb-2">Task Queue</h1>
        <p className="text-terminal-dim">Aggregate task processing statistics</p>
      </div>

      {stats ? (
        <div className="bg-terminal-surface border border-terminal-border rounded-lg p-6 space-y-6 max-w-xl">
          <QueueBar label="Pending" value={stats.pending} max={total || 1} color="text-terminal-yellow" />
          <QueueBar label="Running" value={stats.running} max={total || 1} color="text-terminal-blue" />
          <QueueBar label="Completed (24h)" value={stats.completed24h} max={total || 1} color="text-terminal-green" />
          <QueueBar label="Failed (24h)" value={stats.failed24h} max={total || 1} color="text-terminal-red" />
        </div>
      ) : (
        <p className="text-terminal-dim">Data unavailable</p>
      )}
    </div>
  );
}
