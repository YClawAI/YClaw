import Link from 'next/link';

interface KPICardProps {
  label: string;
  value: string;
  subtext?: string;
  trend?: string;
  trendUp?: boolean;
  href?: string;
}

export function KPICard({ label, value, subtext, trend, trendUp, href }: KPICardProps) {
  const content = (
    <div className="bg-terminal-surface border border-terminal-border rounded p-4 hover:border-terminal-muted transition-colors">
      <div className="text-2xl font-bold text-terminal-text font-mono">{value}</div>
      <div className="text-xs text-terminal-dim mt-1">{label}</div>
      {(subtext || trend) && (
        <div className="flex items-center gap-2 mt-1">
          {subtext && <span className="text-[10px] text-terminal-dim/60">{subtext}</span>}
          {trend && (
            <span className={`text-[10px] font-mono ${trendUp ? 'text-terminal-green' : 'text-terminal-red'}`}>
              {trend}
            </span>
          )}
        </div>
      )}
    </div>
  );

  if (href) {
    return <Link href={href}>{content}</Link>;
  }
  return content;
}
