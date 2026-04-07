'use client';

interface HeartbeatEntry {
  hour: number;
  status: string;
}

interface HeartbeatData {
  agentId: string;
  hours: HeartbeatEntry[];
}

interface HourlyBucket {
  hour: number;
  status: string;
  count: number;
}

interface HeartbeatBucketData {
  agentId: string;
  buckets: HourlyBucket[];
}

interface HeartbeatMonitorProps {
  data: (HeartbeatData | HeartbeatBucketData)[];
}

const CELL_COLORS: Record<string, string> = {
  ran: 'bg-terminal-green',
  idle: 'bg-terminal-muted',
  error: 'bg-terminal-red',
};

function isBucketData(item: HeartbeatData | HeartbeatBucketData): item is HeartbeatBucketData {
  return 'buckets' in item;
}

function getEntries(item: HeartbeatData | HeartbeatBucketData): { hour: number; status: string; count: number }[] {
  if (isBucketData(item)) {
    return item.buckets.map(b => ({
      hour: b.hour,
      status: b.count > 0 ? b.status : 'idle',
      count: b.count,
    }));
  }
  return item.hours.map(h => ({
    hour: h.hour,
    status: h.status,
    count: h.status === 'idle' ? 0 : 1,
  }));
}

function formatTooltip(hour: number, status: string, count: number): string {
  const hourStr = `${String(hour).padStart(2, '0')}:00`;
  if (status === 'idle') return `${hourStr} — idle`;
  const countStr = status === 'error'
    ? `${count} error${count !== 1 ? 's' : ''}`
    : `${count} run${count !== 1 ? 's' : ''}`;
  return `${hourStr} — ${countStr}`;
}

export function HeartbeatMonitor({ data }: HeartbeatMonitorProps) {
  return (
    <div className="bg-terminal-surface border border-terminal-border rounded p-4">
      <h3 className="text-xs font-bold uppercase tracking-widest text-terminal-dim mb-4">
        Heartbeat Monitor
      </h3>

      {data.length === 0 ? (
        <div className="text-xs text-terminal-dim text-center py-8">
          Awaiting fleet data
        </div>
      ) : (
        <>
          {/* Hour labels */}
          <div className="flex items-center gap-0 mb-1 pl-28">
            {Array.from({ length: 24 }, (_, i) => (
              <div
                key={i}
                className="flex-1 text-center text-terminal-dim"
                style={{ fontSize: '7px' }}
              >
                {i % 6 === 0 ? `${String(i).padStart(2, '0')}` : ''}
              </div>
            ))}
          </div>

          <div className="space-y-3">
            {data.map((hb) => {
              const entries = getEntries(hb);
              return (
                <div key={hb.agentId} className="flex items-center gap-3">
                  {/* Agent info */}
                  <div className="w-24 shrink-0">
                    <span className="text-xs text-terminal-text truncate">{hb.agentId}</span>
                  </div>

                  {/* 24h heatmap strip */}
                  <div className="flex-1 flex gap-px">
                    {entries.map((entry) => (
                      <div
                        key={entry.hour}
                        className={`flex-1 h-4 rounded-sm ${CELL_COLORS[entry.status] ?? CELL_COLORS.idle}`}
                        title={formatTooltip(entry.hour, entry.status, entry.count)}
                        style={{ opacity: entry.status === 'idle' ? 0.3 : 1 }}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Legend */}
          <div className="flex items-center gap-4 mt-3 pt-3 border-t border-terminal-border">
            {[
              { label: 'Ran', color: 'bg-terminal-green' },
              { label: 'Idle', color: 'bg-terminal-muted opacity-30' },
              { label: 'Error', color: 'bg-terminal-red' },
            ].map((item) => (
              <div key={item.label} className="flex items-center gap-1.5">
                <div className={`w-2.5 h-2.5 rounded-sm ${item.color}`} />
                <span className="text-[10px] text-terminal-dim">{item.label}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
