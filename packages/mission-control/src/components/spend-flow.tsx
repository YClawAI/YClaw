'use client';

interface SpendSegment {
  label: string;
  value: number;
  color: string;
}

function mapModelToProvider(model: string): string {
  if (model.startsWith('claude')) return 'Anthropic';
  if (model.startsWith('gpt') || model.startsWith('o1') || model.startsWith('o3') || model.startsWith('o4')) return 'OpenAI';
  if (model.startsWith('gemini')) return 'Google';
  if (model.includes('llama') || model.includes('mistral') || model.includes('mixtral')) return 'OpenRouter';
  return 'Other';
}

const PROVIDER_COLORS: Record<string, string> = {
  Anthropic: 'bg-mc-accent',
  OpenAI: 'bg-mc-success',
  Google: 'bg-mc-info',
  OpenRouter: 'bg-mc-blocked',
  AWS: 'bg-mc-warning',
  MongoDB: 'bg-mc-success/60',
  Redis: 'bg-mc-danger/60',
  Other: 'bg-mc-text-tertiary',
};

export function SpendFlow({
  byModel,
  infraCosts,
  todayCents,
  yesterdayCents,
  weekAvgCents,
}: {
  byModel: Array<{ model: string; spendCents: number }>;
  infraCosts: { aws: number; mongoAtlas: number; redisCloud: number } | null;
  todayCents: number;
  yesterdayCents: number;
  weekAvgCents: number;
}) {
  // Group models by provider
  const providerMap = new Map<string, number>();
  for (const m of byModel) {
    const provider = mapModelToProvider(m.model);
    providerMap.set(provider, (providerMap.get(provider) ?? 0) + m.spendCents);
  }

  // Add infra costs
  if (infraCosts) {
    if (infraCosts.aws > 0) providerMap.set('AWS', infraCosts.aws);
    if (infraCosts.mongoAtlas > 0) providerMap.set('MongoDB', infraCosts.mongoAtlas);
    if (infraCosts.redisCloud > 0) providerMap.set('Redis', infraCosts.redisCloud);
  }

  const total = [...providerMap.values()].reduce((s, v) => s + v, 0);
  const segments: SpendSegment[] = [...providerMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([label, value]) => ({
      label,
      value,
      color: PROVIDER_COLORS[label] ?? PROVIDER_COLORS.Other!,
    }));

  const todayDiff = todayCents - yesterdayCents;
  const diffSign = todayDiff >= 0 ? '+' : '';
  const diffColor = todayDiff > 0 ? 'text-mc-danger' : 'text-mc-success';

  return (
    <div>
      {/* Flow bar */}
      {total > 0 && (
        <div className="mb-4">
          <div className="flex h-6 rounded-full overflow-hidden border border-mc-border">
            {segments.map((seg) => {
              const pct = (seg.value / total) * 100;
              if (pct < 1) return null;
              return (
                <div
                  key={seg.label}
                  className={`${seg.color} transition-all relative group`}
                  style={{ width: `${pct}%` }}
                  title={`${seg.label}: $${(seg.value / 100).toFixed(2)} (${pct.toFixed(0)}%)`}
                >
                  {pct > 8 && (
                    <span className="absolute inset-0 flex items-center justify-center text-[10px] font-bold text-white/90 truncate px-1">
                      {seg.label} {pct.toFixed(0)}%
                    </span>
                  )}
                </div>
              );
            })}
          </div>
          {/* Legend */}
          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
            {segments.map((seg) => (
              <div key={seg.label} className="flex items-center gap-1.5">
                <span className={`w-2 h-2 rounded-full ${seg.color}`} />
                <span className="text-[10px] text-mc-text-tertiary">
                  {seg.label}: ${(seg.value / 100).toFixed(2)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Summary line */}
      <div className="flex items-center gap-4 text-xs font-mono">
        <span className="text-mc-text">
          Today: <span className="font-bold">${(todayCents / 100).toFixed(2)}</span>
        </span>
        <span className={diffColor}>
          vs yesterday: {diffSign}${(Math.abs(todayDiff) / 100).toFixed(2)}
        </span>
        <span className="text-mc-text-tertiary">
          7d avg: ${(weekAvgCents / 100).toFixed(2)}
        </span>
      </div>
    </div>
  );
}
