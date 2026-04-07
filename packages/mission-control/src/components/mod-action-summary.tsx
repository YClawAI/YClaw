'use client';

export interface ModActionSummary {
  action: string;
  count: number;
}

interface ModActionSummaryChartProps {
  data: ModActionSummary[];
}

const ACTION_COLORS: Record<string, string> = {
  delete: 'bg-terminal-red',
  restrict: 'bg-terminal-orange',
  ban: 'bg-terminal-red/70',
  pin: 'bg-terminal-blue',
  reply: 'bg-terminal-green',
  unknown: 'bg-terminal-dim',
};

const ACTION_TEXT_COLORS: Record<string, string> = {
  delete: 'text-terminal-red',
  restrict: 'text-terminal-orange',
  ban: 'text-terminal-red/70',
  pin: 'text-terminal-blue',
  reply: 'text-terminal-green',
  unknown: 'text-terminal-dim',
};

export function ModActionSummaryChart({ data }: ModActionSummaryChartProps) {
  if (data.length === 0) {
    return (
      <div className="bg-terminal-surface border border-terminal-border rounded p-4">
        <div className="text-xs font-bold uppercase tracking-widest text-terminal-dim mb-3">
          Mod Actions
        </div>
        <div className="flex items-center justify-center py-6">
          <span className="text-xs text-terminal-dim">No action data</span>
        </div>
      </div>
    );
  }

  const maxCount = Math.max(...data.map((d) => d.count), 1);

  return (
    <div className="bg-terminal-surface border border-terminal-border rounded p-4">
      <div className="text-xs font-bold uppercase tracking-widest text-terminal-dim mb-3">
        Mod Actions
      </div>

      <div className="space-y-2">
        {data.map((item) => {
          const widthPercent = (item.count / maxCount) * 100;

          return (
            <div key={item.action} className="flex items-center gap-2">
              <span className={`text-[10px] font-mono w-16 text-right ${ACTION_TEXT_COLORS[item.action] ?? 'text-terminal-dim'}`}>
                {item.action}
              </span>
              <div className="flex-1 h-4 bg-terminal-bg rounded overflow-hidden relative">
                <div
                  className={`h-full rounded transition-all duration-300 ${ACTION_COLORS[item.action] ?? 'bg-terminal-dim'}`}
                  style={{ width: `${widthPercent}%` }}
                />
              </div>
              <span className="text-[10px] font-mono text-terminal-text w-8 text-right">
                {item.count}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
