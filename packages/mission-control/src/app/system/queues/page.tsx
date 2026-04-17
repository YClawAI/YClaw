export const dynamic = 'force-dynamic';

import { redisZrange, redisGet } from '@/lib/redis';
import { StatusBadge } from '@/components/status-badge';
import { RefreshTrigger } from '@/components/refresh-trigger';

const PRIORITIES = ['P0', 'P1', 'P2', 'P3'] as const;
type Priority = (typeof PRIORITIES)[number];

const PRIORITY_COLORS: Record<Priority, string> = {
  P0: 'text-mc-danger',
  P1: 'text-mc-blocked',
  P2: 'text-mc-warning',
  P3: 'text-mc-text-tertiary',
};

interface TaskRecord {
  taskId: string;
  agentId?: string;
  status?: string;
  title?: string;
  description?: string;
  createdAt?: string;
  priority?: string;
}

async function getQueueData() {
  const queues: Record<Priority, TaskRecord[]> = { P0: [], P1: [], P2: [], P3: [] };

  for (const priority of PRIORITIES) {
    const taskIds = await redisZrange(`builder:task_queue:${priority}`, 0, -1);
    for (const taskId of taskIds) {
      const raw = await redisGet(`builder:task:${taskId}`);
      if (raw) {
        try {
          const task = JSON.parse(raw) as TaskRecord;
          queues[priority].push({ ...task, taskId });
        } catch {
          queues[priority].push({ taskId, status: 'unknown' });
        }
      } else {
        queues[priority].push({ taskId, status: 'unknown' });
      }
    }
  }

  return queues;
}

export default async function BuilderQueuePage() {
  const queues = await getQueueData();
  const totalTasks = Object.values(queues).reduce((sum, q) => sum + q.length, 0);

  return (
    <div>
      <RefreshTrigger />
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-lg font-bold text-mc-text tracking-wide">Task Queue</h1>
          <p className="text-xs text-mc-text-tertiary mt-1">P0 (safety) → P1 (reviews) → P2 (issues) → P3 (background)</p>
        </div>
        <span className="text-sm text-mc-text-tertiary font-mono">{totalTasks} tasks</span>
      </div>

      <div className="flex flex-col gap-6">
        {PRIORITIES.map((priority) => {
          const tasks = queues[priority];
          return (
            <section key={priority}>
              <h2 className={`text-xs font-bold uppercase tracking-widest mb-3 ${PRIORITY_COLORS[priority]}`}>
                {priority} — {tasks.length} task{tasks.length !== 1 ? 's' : ''}
              </h2>

              {tasks.length === 0 ? (
                <div className="text-mc-text-tertiary text-sm py-3 px-4 border border-mc-border/50 rounded bg-mc-surface-hover/30">
                  Empty
                </div>
              ) : (
                <div className="border border-mc-border rounded overflow-hidden">
                  <table className="w-full text-sm font-mono">
                    <thead className="bg-mc-surface-hover border-b border-mc-border">
                      <tr>
                        {['Task ID', 'Agent', 'Status', 'Title', 'Created'].map((h) => (
                          <th key={h} className="text-left px-4 py-2 text-xs text-mc-text-tertiary font-normal">
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {tasks.map((task) => (
                        <tr key={task.taskId} className="border-b border-mc-border/50 hover:bg-mc-surface-hover/50">
                          <td className="px-4 py-2 text-mc-text truncate max-w-40 font-mono text-xs">
                            {task.taskId}
                          </td>
                          <td className="px-4 py-2 text-mc-accent">{task.agentId ?? '—'}</td>
                          <td className="px-4 py-2">
                            {task.status ? <StatusBadge status={task.status} /> : '—'}
                          </td>
                          <td className="px-4 py-2 text-mc-text truncate max-w-64">
                            {task.title ?? task.description ?? '—'}
                          </td>
                          <td className="px-4 py-2 text-mc-text-tertiary text-xs">
                            {task.createdAt ? new Date(task.createdAt).toLocaleString() : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
