'use client';

export interface ModActionSummary {
  action: string;
  count: number;
}

interface ModActionSummaryChartProps {
  data: ModActionSummary[];
}

const ACTION_COLORS: Record<string, string> = {
  delete: 'bg-mc-danger',
  restrict: 'bg-mc-blocked',
  ban: 'bg-mc-danger/70',
  pin: 'bg-mc-info',
  reply: 'bg-mc-success',
  unknown: 'bg-mc-text-tertiary',
};

const ACTION_TEXT_COLORS: Record<string, string> = {
  delete: 'text-mc-danger',
  restrict: 'text-mc-blocked',
  ban: 'text-mc-danger/70',
  pin: 'text-mc-info',
  reply: 'text-mc-success',
  unknown: 'text-mc-text-tertiary',
};

export function ModActionSummaryChart({ data }: ModActionSummaryChartProps) {
  if (data.length === 0) {
    return (
      <div className="bg-mc-surface-hover border border-mc-border rounded p-4">
        <div className="text-xs font-bold uppercase tracking-widest text-mc-text-tertiary mb-3">
          Mod Actions
        </div>
        <div className="flex items-center justify-center py-6">
          <span className="text-xs text-mc-text-tertiary">No action data</span>
        </div>
      </div>
    );
  }

  const maxCount = Math.max(...data.map((d) => d.count), 1);

  return (
    <div className="bg-mc-surface-hover border border-mc-border rounded p-4">
      <div className="text-xs font-bold uppercase tracking-widest text-mc-text-tertiary mb-3">
        Mod Actions
      </div>

      <div className="space-y-2">
        {data.map((item) => {
          const widthPercent = (item.count / maxCount) * 100;

          return (
            <div key={item.action} className="flex items-center gap-2">
              <span className={`text-[10px] font-mono w-16 text-right ${ACTION_TEXT_COLORS[item.action] ?? 'text-mc-text-tertiary'}`}>
                {item.action}
              </span>
              <div className="flex-1 h-4 bg-mc-bg rounded overflow-hidden relative">
                <div
                  className={`h-full rounded transition-all duration-300 ${ACTION_COLORS[item.action] ?? 'bg-mc-text-tertiary'}`}
                  style={{ width: `${widthPercent}%` }}
                />
              </div>
              <span className="text-[10px] font-mono text-mc-text w-8 text-right">
                {item.count}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
