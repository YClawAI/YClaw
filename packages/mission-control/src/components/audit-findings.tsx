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
  if (grade.startsWith('A')) return 'text-terminal-green';
  if (grade.startsWith('B')) return 'text-terminal-blue';
  if (grade.startsWith('C')) return 'text-terminal-yellow';
  return 'text-terminal-red';
}

function gradeBg(grade: string): string {
  if (grade.startsWith('A')) return 'bg-terminal-green/10 border-terminal-green/30';
  if (grade.startsWith('B')) return 'bg-terminal-blue/10 border-terminal-blue/30';
  if (grade.startsWith('C')) return 'bg-terminal-yellow/10 border-terminal-yellow/30';
  return 'bg-terminal-red/10 border-terminal-red/30';
}

export function AuditFindings({ latestAudit, auditHistory }: AuditFindingsProps) {
  if (!latestAudit && (!auditHistory || auditHistory.length === 0)) {
    return (
      <div className="bg-terminal-surface border border-terminal-border rounded p-6">
        <div className="text-xs text-terminal-dim text-center">Awaiting Sentinel audit data</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Latest Audit Summary */}
      {latestAudit && (
        <div className="bg-terminal-surface border border-terminal-border rounded p-4">
          <div className="flex items-start justify-between mb-4">
            <div>
              <h3 className="text-xs font-bold uppercase tracking-widest text-terminal-dim mb-2">
                Latest Audit
              </h3>
              <div className="flex items-center gap-4 text-[10px] font-mono text-terminal-dim">
                <span>date: {latestAudit.date}</span>
                {latestAudit.findingsCount != null && (
                  <span>{latestAudit.findingsCount} findings</span>
                )}
              </div>
              {latestAudit.summary && (
                <div className="text-[10px] font-mono text-terminal-dim mt-1">
                  {latestAudit.summary}
                </div>
              )}
              {latestAudit.gradeParseError && latestAudit.rawOutputSnippet && (
                <div className="mt-2 p-2 rounded bg-terminal-muted/20 border border-terminal-border">
                  <div className="text-[10px] font-mono text-terminal-yellow mb-1">Raw output snippet:</div>
                  <pre className="text-[10px] font-mono text-terminal-dim whitespace-pre-wrap break-words">
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
              <div className="px-3 py-2 rounded border border-terminal-yellow/30 bg-terminal-yellow/10 font-mono text-xs text-terminal-yellow max-w-[200px]">
                <div className="font-bold mb-1">Grade: parsing error</div>
                <div className="text-[10px] text-terminal-dim">Check raw output</div>
              </div>
            ) : null}
          </div>
        </div>
      )}

      {/* Audit History */}
      {auditHistory && auditHistory.length > 0 && (
        <div className="bg-terminal-surface border border-terminal-border rounded">
          <div className="px-4 py-3 border-b border-terminal-border">
            <h3 className="text-xs font-bold uppercase tracking-widest text-terminal-dim">
              Audit History
            </h3>
          </div>
          <div className="divide-y divide-terminal-border/50">
            {auditHistory.map((entry, i) => (
              <div
                key={`${entry.date}-${i}`}
                className="px-4 py-2.5 flex items-center justify-between hover:bg-terminal-muted/20 transition-colors"
              >
                <div className="flex items-center gap-4 text-xs font-mono">
                  <span className="text-terminal-dim w-24">{entry.date}</span>
                  {entry.grade ? (
                    <span className={`font-bold w-8 ${gradeColor(entry.grade)}`}>{entry.grade}</span>
                  ) : entry.gradeParseError ? (
                    <span className="text-terminal-yellow w-8" title={entry.rawOutputSnippet ?? 'Grade could not be parsed from output'}>??</span>
                  ) : null}
                  {entry.findingsCount != null && (
                    <span className="text-terminal-dim">{entry.findingsCount} findings</span>
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
