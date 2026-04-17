'use client';

export interface CommunityTemperature {
  level: string;
  score: number;
  factors?: string[];
  lastUpdated?: string;
}

interface CommunityTemperatureProps {
  data?: CommunityTemperature;
}

const LEVELS = [
  { key: 'calm', label: 'CALM', position: 12.5 },
  { key: 'active', label: 'ACTIVE', position: 37.5 },
  { key: 'heated', label: 'HEATED', position: 62.5 },
  { key: 'crisis', label: 'CRISIS', position: 87.5 },
] as const;

export function CommunityTemperature({ data }: CommunityTemperatureProps) {
  if (!data) {
    return (
      <div className="bg-mc-surface-hover border border-mc-border rounded p-4">
        <h3 className="text-xs font-bold uppercase tracking-widest text-mc-text-tertiary mb-4">
          Community Temperature
        </h3>
        <div className="flex items-center justify-center py-6">
          <span className="text-xs text-mc-text-tertiary">Community data unavailable</span>
        </div>
      </div>
    );
  }

  const markerPosition = data.score;

  return (
    <div className="bg-mc-surface-hover border border-mc-border rounded p-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-xs font-bold uppercase tracking-widest text-mc-text-tertiary">
          Community Temperature
        </h3>
        {data.lastUpdated && (
          <span className="text-[10px] text-mc-text-tertiary font-mono">
            Updated {data.lastUpdated}
          </span>
        )}
      </div>

      {/* Gauge bar */}
      <div className="relative mb-3">
        <div className="h-3 rounded-full overflow-hidden relative">
          {/* Gradient background */}
          <div
            className="absolute inset-0 rounded-full"
            style={{
              background: 'linear-gradient(to right, #30D158 0%, #FFD60A 33%, #FF9F0A 66%, #FF453A 100%)',
            }}
          />
          {/* Dark overlay for unfilled portion */}
          <div
            className="absolute top-0 right-0 bottom-0 rounded-r-full"
            style={{
              left: `${markerPosition}%`,
              background: 'rgba(10, 10, 15, 0.6)',
            }}
          />
        </div>

        {/* Pointer / marker */}
        <div
          className="absolute top-0 -translate-x-1/2"
          style={{ left: `${markerPosition}%` }}
        >
          <div className="w-0.5 h-3 bg-mc-text" />
          <svg
            className="w-3 h-2 -translate-x-[5px] text-mc-text"
            viewBox="0 0 12 8"
            fill="currentColor"
          >
            <path d="M6 8L0 0h12z" />
          </svg>
        </div>

        {/* Level labels */}
        <div className="flex justify-between mt-3">
          {LEVELS.map((level) => (
            <span
              key={level.key}
              className={`text-[10px] font-mono tracking-wider ${
                level.key === data.level
                  ? 'text-mc-text font-bold'
                  : 'text-mc-text-tertiary'
              }`}
            >
              {level.label}
            </span>
          ))}
        </div>
      </div>

      {/* Score display */}
      <div className="flex items-center gap-2 mb-3 mt-4">
        <span className="text-lg font-bold text-mc-text font-mono">{data.score}</span>
        <span className="text-[10px] text-mc-text-tertiary">/ 100</span>
        <span className={`text-xs font-bold font-mono uppercase ml-2 ${
          data.level === 'calm' ? 'text-mc-success' :
          data.level === 'active' ? 'text-mc-warning' :
          data.level === 'heated' ? 'text-mc-blocked' :
          'text-mc-danger'
        }`}>
          {data.level}
        </span>
      </div>

      {/* Contributing factors */}
      {data.factors && data.factors.length > 0 && (
        <div className="border-t border-mc-border pt-3">
          <div className="text-[10px] font-bold uppercase tracking-widest text-mc-text-tertiary mb-2">
            Contributing Factors
          </div>
          <ul className="space-y-1">
            {data.factors.map((factor, i) => (
              <li key={i} className="flex items-start gap-2 text-xs text-mc-text">
                <svg className="w-3 h-3 mt-0.5 text-mc-warning shrink-0" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <circle cx="6" cy="6" r="5" />
                  <line x1="6" y1="3" x2="6" y2="6.5" />
                  <circle cx="6" cy="8.5" r="0.5" fill="currentColor" />
                </svg>
                <span>{factor}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
