'use client';

export type IntelHighlight = {
  id: string;
  topic: string;
  summary: string;
  sentiment?: string;
};

export type Prospect = {
  id: string;
  name: string;
  handle?: string;
  stage?: string;
};

export type OutreachEntry = {
  id: string;
  recipient: string;
  status?: string;
};

interface ScoutIntelProps {
  highlights: IntelHighlight[];
  prospects: Prospect[];
  outreach: OutreachEntry[];
}

type ProspectStage = 'new' | 'contacted' | 'follow_up' | 'responded';

const STAGE_LABELS: Record<ProspectStage, string> = {
  new: 'NEW',
  contacted: 'CONTACTED',
  follow_up: 'FOLLOW-UP',
  responded: 'RESPONDED',
};

const STAGE_COLORS: Record<ProspectStage, string> = {
  new: 'border-mc-text-tertiary/30',
  contacted: 'border-mc-info/30',
  follow_up: 'border-mc-warning/30',
  responded: 'border-mc-success/30',
};

const STAGE_HEADER_COLORS: Record<ProspectStage, string> = {
  new: 'text-mc-text-tertiary',
  contacted: 'text-mc-info',
  follow_up: 'text-mc-warning',
  responded: 'text-mc-success',
};

function sentimentColor(sentiment?: string): string {
  switch (sentiment) {
    case 'positive': return 'text-mc-success';
    case 'negative': return 'text-mc-danger';
    case 'neutral': return 'text-mc-text-tertiary';
    default: return 'text-mc-text-tertiary';
  }
}

function SentimentTag({ sentiment }: { sentiment?: string }) {
  if (!sentiment) return null;
  return (
    <span className={`text-[10px] font-mono font-bold uppercase ${sentimentColor(sentiment)}`}>
      [{sentiment}]
    </span>
  );
}

function IntelCard({ item }: { item: IntelHighlight }) {
  return (
    <div className="bg-mc-surface-hover border border-mc-border rounded p-3">
      <div className="flex items-start justify-between gap-2 mb-2">
        <span className="text-xs font-mono font-bold text-mc-blocked">{item.topic}</span>
        <SentimentTag sentiment={item.sentiment} />
      </div>
      <p className="text-xs text-mc-text/80 font-mono leading-relaxed">
        {item.summary}
      </p>
    </div>
  );
}

function ProspectPipeline({ prospects }: { prospects: Prospect[] }) {
  const stages: ProspectStage[] = ['new', 'contacted', 'follow_up', 'responded'];
  const byStage = new Map<ProspectStage, Prospect[]>();
  for (const stage of stages) {
    byStage.set(stage, prospects.filter((p) => p.stage === stage));
  }

  return (
    <div>
      <div className="text-xs font-bold uppercase tracking-widest text-mc-text-tertiary mb-3">
        PROSPECT PIPELINE
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {stages.map((stage) => {
          const items = byStage.get(stage) ?? [];
          return (
            <div key={stage} className={`border rounded ${STAGE_COLORS[stage]}`}>
              <div className="px-3 py-2 border-b border-mc-border/50">
                <span className={`text-[10px] font-bold uppercase tracking-widest font-mono ${STAGE_HEADER_COLORS[stage]}`}>
                  {STAGE_LABELS[stage]}
                </span>
                <span className="text-[10px] text-mc-text-tertiary font-mono ml-2">{items.length}</span>
              </div>
              <div className="p-2 space-y-1 min-h-[80px]">
                {items.length === 0 ? (
                  <div className="text-[10px] text-mc-text-tertiary/40 font-mono text-center py-3">--</div>
                ) : (
                  items.map((p) => (
                    <div key={p.id} className="bg-mc-bg/50 rounded px-2 py-1.5">
                      <div className="text-xs text-mc-text font-mono truncate">{p.name}</div>
                      {p.handle && <div className="text-[10px] text-mc-text-tertiary font-mono">{p.handle}</div>}
                    </div>
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function statusColor(status?: string): string {
  switch (status) {
    case 'sent': return 'text-mc-info';
    case 'opened': return 'text-mc-accent';
    case 'replied': return 'text-mc-success';
    case 'bounced': return 'text-mc-danger';
    default: return 'text-mc-text-tertiary';
  }
}

function OutreachTable({ entries }: { entries: OutreachEntry[] }) {
  return (
    <div>
      <div className="text-xs font-bold uppercase tracking-widest text-mc-text-tertiary mb-3">
        OUTREACH STATUS
      </div>
      <div className="bg-mc-surface-hover border border-mc-border rounded overflow-x-auto">
        <table className="w-full min-w-[480px]">
          <thead>
            <tr className="border-b border-mc-border">
              <th className="px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-mc-text-tertiary text-left">
                RECIPIENT
              </th>
              <th className="px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-mc-text-tertiary text-left">
                STATUS
              </th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.id} className="border-b border-mc-border/50 hover:bg-mc-border/20 transition-colors">
                <td className="px-3 py-2 text-xs text-mc-text font-mono">
                  {entry.recipient}
                </td>
                <td className={`px-3 py-2 text-[10px] font-mono font-bold uppercase ${statusColor(entry.status)}`}>
                  {entry.status ?? '--'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function ScoutIntel({ highlights, prospects, outreach }: ScoutIntelProps) {
  if (highlights.length === 0 && prospects.length === 0 && outreach.length === 0) {
    return (
      <div className="flex items-center justify-center py-8">
        <span className="text-xs text-mc-text-tertiary">No intel data</span>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Daily Intel Highlights */}
      {highlights.length > 0 && (
        <div>
          <div className="text-xs font-bold uppercase tracking-widest text-mc-text-tertiary mb-3">
            DAILY INTEL HIGHLIGHTS
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {highlights.map((item) => (
              <IntelCard key={item.id} item={item} />
            ))}
          </div>
        </div>
      )}

      {/* Prospect Pipeline */}
      {prospects.length > 0 ? (
        <ProspectPipeline prospects={prospects} />
      ) : (
        <div>
          <div className="text-xs font-bold uppercase tracking-widest text-mc-text-tertiary mb-3">
            PROSPECT PIPELINE
          </div>
          <div className="bg-mc-surface-hover border border-mc-border rounded p-4 text-xs text-mc-text-tertiary text-center font-mono">
            Prospect tracking will be available when Scout writes to a dedicated collection.
          </div>
        </div>
      )}

      {/* Outreach Status */}
      {outreach.length > 0 ? (
        <OutreachTable entries={outreach} />
      ) : (
        <div>
          <div className="text-xs font-bold uppercase tracking-widest text-mc-text-tertiary mb-3">
            OUTREACH STATUS
          </div>
          <div className="bg-mc-surface-hover border border-mc-border rounded p-4 text-xs text-mc-text-tertiary text-center font-mono">
            No outreach data.
          </div>
        </div>
      )}
    </div>
  );
}
