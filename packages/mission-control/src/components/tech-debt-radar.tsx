'use client';

// ─── Local Types ──────────────────────────────────────────────────────────────

export interface TechDebtAxis {
  label: string;
  score: number;
}

export interface TechDebtItem {
  title: string;
  severity: string;
  files?: string[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function healthColor(value: number): string {
  if (value >= 80) return 'text-mc-success';
  if (value >= 50) return 'text-mc-warning';
  return 'text-mc-danger';
}

function severityBadge(severity: string): { label: string; className: string } {
  if (severity === 'critical') return { label: 'CRITICAL', className: 'bg-mc-danger/10 text-mc-danger border-mc-danger/30' };
  if (severity === 'warning') return { label: 'WARNING', className: 'bg-mc-warning/10 text-mc-warning border-mc-warning/30' };
  return { label: 'INFO', className: 'bg-mc-text-tertiary/10 text-mc-text-tertiary border-mc-border' };
}

// ─── SVG Radar Chart ─────────────────────────────────────────────────────────

function RadarChart({ axes }: { axes: TechDebtAxis[] }) {
  const cx = 150;
  const cy = 150;
  const maxRadius = 110;
  const levels = 4;
  const n = axes.length;

  if (n === 0) {
    return (
      <div className="flex items-center justify-center h-[300px] text-xs text-mc-text-tertiary">
        No tech debt axes configured
      </div>
    );
  }

  const angleStep = (2 * Math.PI) / n;
  const startAngle = -Math.PI / 2;

  function polarToXY(angle: number, radius: number): { x: number; y: number } {
    return {
      x: cx + radius * Math.cos(angle),
      y: cy + radius * Math.sin(angle),
    };
  }

  const gridRings = Array.from({ length: levels }, (_, i) => {
    const r = (maxRadius / levels) * (i + 1);
    const points = Array.from({ length: n }, (_, j) => {
      const angle = startAngle + j * angleStep;
      return polarToXY(angle, r);
    });
    return points.map(p => `${p.x},${p.y}`).join(' ');
  });

  const axisLines = Array.from({ length: n }, (_, j) => {
    const angle = startAngle + j * angleStep;
    return polarToXY(angle, maxRadius);
  });

  const dataPoints = axes.map((axis, j) => {
    const angle = startAngle + j * angleStep;
    const r = (axis.score / 100) * maxRadius;
    return polarToXY(angle, r);
  });
  const dataPolygon = dataPoints.map(p => `${p.x},${p.y}`).join(' ');

  const avgScore = axes.reduce((s, a) => s + a.score, 0) / axes.length;
  const fillColor = avgScore >= 80 ? '#30D158' : avgScore >= 50 ? '#FFD60A' : '#FF453A';

  const labelPositions = axes.map((axis, j) => {
    const angle = startAngle + j * angleStep;
    const labelRadius = maxRadius + 22;
    const pos = polarToXY(angle, labelRadius);
    return { ...pos, label: axis.label, value: axis.score };
  });

  return (
    <svg viewBox="0 0 300 300" className="w-full max-w-[300px] mx-auto">
      {gridRings.map((ring, i) => (
        <polygon key={i} points={ring} fill="none" stroke="rgba(90,200,250,0.12)" strokeWidth="1" />
      ))}
      {axisLines.map((pt, i) => (
        <line key={i} x1={cx} y1={cy} x2={pt.x} y2={pt.y} stroke="rgba(90,200,250,0.12)" strokeWidth="1" />
      ))}
      <polygon points={dataPolygon} fill={fillColor} fillOpacity="0.15" stroke={fillColor} strokeWidth="2" />
      {dataPoints.map((pt, i) => (
        <circle key={i} cx={pt.x} cy={pt.y} r="3" fill={axes[i]!.score >= 80 ? '#30D158' : axes[i]!.score >= 50 ? '#FFD60A' : '#FF453A'} />
      ))}
      {labelPositions.map((lp, i) => (
        <text key={i} x={lp.x} y={lp.y} textAnchor="middle" dominantBaseline="middle" fill="rgba(255,255,255,0.30)" fontSize="9" fontFamily="monospace">
          {lp.label}
        </text>
      ))}
      {dataPoints.map((pt, i) => (
        <text key={`v-${i}`} x={pt.x} y={pt.y - 10} textAnchor="middle" fill={axes[i]!.score >= 80 ? '#30D158' : axes[i]!.score >= 50 ? '#FFD60A' : '#FF453A'} fontSize="9" fontWeight="bold" fontFamily="monospace">
          {axes[i]!.score}
        </text>
      ))}
    </svg>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

interface TechDebtRadarProps {
  axes: TechDebtAxis[];
  items: TechDebtItem[];
}

export function TechDebtRadar({ axes, items }: TechDebtRadarProps) {
  if (axes.length === 0 && items.length === 0) {
    return (
      <div className="bg-mc-surface-hover border border-mc-border rounded p-4 flex items-center justify-center py-8">
        <span className="text-xs text-mc-text-tertiary">Awaiting Sentinel audit data</span>
      </div>
    );
  }

  const avgScore = axes.length > 0 ? Math.round(axes.reduce((s, a) => s + a.score, 0) / axes.length) : 0;

  return (
    <div className="space-y-6">
      {/* Radar Chart */}
      {axes.length > 0 && (
        <div className="bg-mc-surface-hover border border-mc-border rounded p-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-xs font-bold uppercase tracking-widest text-mc-text-tertiary">Tech Debt Radar</h3>
            <div className="flex items-center gap-2">
              <span className={`text-lg font-bold font-mono ${healthColor(avgScore)}`}>{avgScore}</span>
              <span className="text-[10px] text-mc-text-tertiary">/ 100</span>
            </div>
          </div>

          <RadarChart axes={axes} />

          <div className="mt-4 grid grid-cols-2 md:grid-cols-5 gap-3">
            {axes.map(axis => (
              <div key={axis.label} className="text-center">
                <div className={`text-sm font-bold font-mono ${healthColor(axis.score)}`}>{axis.score}</div>
                <div className="text-[10px] text-mc-text-tertiary">{axis.label}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tech Debt Items */}
      {items.length > 0 && (
        <div className="bg-mc-surface-hover border border-mc-border rounded">
          <div className="px-4 py-3 border-b border-mc-border flex items-center justify-between">
            <h3 className="text-xs font-bold uppercase tracking-widest text-mc-text-tertiary">Prioritized Debt Items</h3>
            <span className="text-[10px] font-mono text-mc-text-tertiary">{items.length} items</span>
          </div>
          <div className="divide-y divide-mc-border/50">
            {items.map((item, idx) => {
              const badge = severityBadge(item.severity);
              return (
                <div key={idx} className="px-4 py-3">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded border ${badge.className}`}>
                      {badge.label}
                    </span>
                    <span className="text-xs font-bold text-mc-text">{item.title}</span>
                  </div>
                  {item.files && item.files.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {item.files.map(file => (
                        <span key={file} className="text-[10px] font-mono text-mc-info bg-mc-info/5 px-1.5 py-0.5 rounded">
                          {file}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
