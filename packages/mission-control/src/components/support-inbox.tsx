'use client';

export interface SupportCase {
  id: string;
  status: string;
  lastMessage?: string;
  assignedTo?: string;
  createdAt?: string;
}

interface SupportInboxProps {
  cases: SupportCase[];
}

const STATUS_COLORS: Record<string, string> = {
  new: 'text-mc-success',
  in_progress: 'text-mc-info',
  escalated: 'text-mc-blocked',
  resolved: 'text-mc-text-tertiary',
  cancelled: 'text-mc-text-tertiary',
};

const STATUS_LABELS: Record<string, string> = {
  new: 'PENDING',
  in_progress: 'RUNNING',
  escalated: 'ERROR',
  resolved: 'COMPLETED',
  cancelled: 'CANCELLED',
};

export function SupportInbox({ cases }: SupportInboxProps) {
  if (cases.length === 0) {
    return (
      <div className="bg-mc-surface-hover border border-mc-border rounded p-4">
        <div className="flex items-center justify-center py-6">
          <span className="text-xs text-mc-text-tertiary">No recent Guide agent runs</span>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-mc-surface-hover border border-mc-border rounded">
      {/* Disclosure: this is agent run data, not a ticket system */}
      <div className="px-4 py-2 border-b border-mc-border/50">
        <span className="text-[10px] text-mc-text-tertiary font-mono">
          Status derived from run result.
        </span>
      </div>
      <div className="divide-y divide-mc-border/50">
        {cases.map((c) => (
          <div key={c.id} className="px-4 py-3">
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-mc-text font-mono">
                  {c.id}
                </span>
                <span className={`text-[10px] font-mono font-bold uppercase ${STATUS_COLORS[c.status] ?? 'text-mc-text-tertiary'}`}>
                  {STATUS_LABELS[c.status] ?? c.status}
                </span>
              </div>
              <div className="flex items-center gap-2">
                {c.assignedTo && (
                  <span className="text-[10px] font-mono text-mc-text-tertiary px-1 py-0.5 rounded border border-mc-border uppercase">
                    {c.assignedTo}
                  </span>
                )}
                {c.createdAt && (
                  <span className="text-[10px] text-mc-text-tertiary font-mono">
                    {new Date(c.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  </span>
                )}
              </div>
            </div>
            {c.lastMessage && (
              <div className="text-[10px] text-mc-text-tertiary leading-relaxed line-clamp-2 mt-1">
                {c.lastMessage}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
