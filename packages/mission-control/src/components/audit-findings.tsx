'use client';

export interface AuditSummary {
  date: string;
  grade?: string;
  gradeParseError?: boolean;
  rawOutputSnippet?: string;
  findingsCount?: number;
  summary?: string;
}

export interface AuditHistoryEntry {
  date: string;
  grade?: string;
  gradeParseError?: boolean;
  rawOutputSnippet?: string;
  findingsCount?: number;
}

interface AuditFindingsProps {
  latestAudit?: AuditSummary;
  auditHistory?: AuditHistoryEntry[];
}

function gradeColor(grade: string): string {
  if (grade.startsWith('A')) return 'text-mc-success';
  if (grade.startsWith('B')) return 'text-mc-info';
  if (grade.startsWith('C')) return 'text-mc-warning';
  return 'text-mc-danger';
}

function gradeBg(grade: string): string {
  if (grade.startsWith('A')) return 'bg-mc-success/10 border-mc-success/30';
  if (grade.startsWith('B')) return 'bg-mc-info/10 border-mc-info/30';
  if (grade.startsWith('C')) return 'bg-mc-warning/10 border-mc-warning/30';
  return 'bg-mc-danger/10 border-mc-danger/30';
}

export function AuditFindings({ latestAudit, auditHistory }: AuditFindingsProps) {
  if (!latestAudit && (!auditHistory || auditHistory.length === 0)) {
    return (
      <div className="bg-mc-surface-hover border border-mc-border rounded p-6">
        <div className="text-xs text-mc-text-tertiary text-center">Awaiting Sentinel audit data</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Latest Audit Summary */}
      {latestAudit && (
        <div className="bg-mc-surface-hover border border-mc-border rounded p-4">
          <div className="flex items-start justify-between mb-4">
            <div>
              <h3 className="text-xs font-bold uppercase tracking-widest text-mc-text-tertiary mb-2">
                Latest Audit
              </h3>
              <div className="flex items-center gap-4 text-[10px] font-mono text-mc-text-tertiary">
                <span>date: {latestAudit.date}</span>
                {latestAudit.findingsCount != null && (
                  <span>{latestAudit.findingsCount} findings</span>
                )}
              </div>
              {latestAudit.summary && (
                <div className="text-[10px] font-mono text-mc-text-tertiary mt-1">
                  {latestAudit.summary}
                </div>
              )}
              {latestAudit.gradeParseError && latestAudit.rawOutputSnippet && (
                <div className="mt-2 p-2 rounded bg-mc-border/20 border border-mc-border">
                  <div className="text-[10px] font-mono text-mc-warning mb-1">Raw output snippet:</div>
                  <pre className="text-[10px] font-mono text-mc-text-tertiary whitespace-pre-wrap break-words">
                    {latestAudit.rawOutputSnippet}
                  </pre>
                </div>
              )}
            </div>
            {latestAudit.grade ? (
              <div className={`px-3 py-2 rounded border font-mono text-2xl font-bold ${gradeBg(latestAudit.grade)} ${gradeColor(latestAudit.grade)}`}>
                {latestAudit.grade}
              </div>
            ) : latestAudit.gradeParseError ? (
              <div className="px-3 py-2 rounded border border-mc-warning/30 bg-mc-warning/10 font-mono text-xs text-mc-warning max-w-[200px]">
                <div className="font-bold mb-1">Grade: parsing error</div>
                <div className="text-[10px] text-mc-text-tertiary">Check raw output</div>
              </div>
            ) : null}
          </div>
        </div>
      )}

      {/* Audit History */}
      {auditHistory && auditHistory.length > 0 && (
        <div className="bg-mc-surface-hover border border-mc-border rounded">
          <div className="px-4 py-3 border-b border-mc-border">
            <h3 className="text-xs font-bold uppercase tracking-widest text-mc-text-tertiary">
              Audit History
            </h3>
          </div>
          <div className="divide-y divide-mc-border/50">
            {auditHistory.map((entry, i) => (
              <div
                key={`${entry.date}-${i}`}
                className="px-4 py-2.5 flex items-center justify-between hover:bg-mc-border/20 transition-colors"
              >
                <div className="flex items-center gap-4 text-xs font-mono">
                  <span className="text-mc-text-tertiary w-24">{entry.date}</span>
                  {entry.grade ? (
                    <span className={`font-bold w-8 ${gradeColor(entry.grade)}`}>{entry.grade}</span>
                  ) : entry.gradeParseError ? (
                    <span className="text-mc-warning w-8" title={entry.rawOutputSnippet ?? 'Grade could not be parsed from output'}>??</span>
                  ) : null}
                  {entry.findingsCount != null && (
                    <span className="text-mc-text-tertiary">{entry.findingsCount} findings</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
