import Link from 'next/link';

interface KPICardProps {
  label: string;
  value: string;
  subtext?: string;
  trend?: string;
  trendUp?: boolean;
  href?: string;
}

/**
 * Legacy wrapper for pre-Phase 2 callers. Prefer `<Metric>` from
 * `@/components/ui` for new work — this component now delegates to the
 * same visual design (accent rule, outlined panel, Inter label,
 * JetBrains-mono numeric) but keeps its original prop shape so
 * un-migrated consumers continue to render without edits.
 */
export function KPICard({ label, value, subtext, trend, trendUp, href }: KPICardProps) {
  const content = (
    <div className="relative border border-mc-border rounded-panel bg-transparent px-4 py-3 transition-colors duration-mc ease-mc-out hover:border-mc-border-hover">
      <div className="absolute left-0 top-0 h-0.5 w-8 rounded-tl-panel bg-mc-accent" />
      <div className="font-sans text-[10px] font-medium uppercase tracking-label text-mc-text-label">
        {label}
      </div>
      <div className="mt-2 flex items-baseline gap-1.5">
        <span className="font-mono text-2xl text-mc-text tabular-nums">{value}</span>
      </div>
      {(subtext || trend) && (
        <div className="mt-1 flex items-center gap-2">
          {subtext && <span className="font-sans text-[11px] text-mc-text-tertiary">{subtext}</span>}
          {trend && (
            <span
              className={`font-mono tabular-nums text-[11px] ${trendUp ? 'text-mc-success' : 'text-mc-danger'}`}
            >
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
