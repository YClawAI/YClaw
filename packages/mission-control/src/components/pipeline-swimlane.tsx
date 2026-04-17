'use client';

import { useState } from 'react';

// ─── Local Types ──────────────────────────────────────────────────────────────

export interface PipelinePR {
  id: string;
  title: string;
  number?: number;
  author?: string;
  status: string;
  stage: string;
  updatedAt?: string;
}

export interface DeployQueueItem {
  id: string;
  title: string;
  env?: string;
  estimatedAt?: string;
}

// ─── Stage Definitions ───────────────────────────────────────────────────────

const PIPELINE_STAGES = [
  { key: 'issue_created', label: 'Issue' },
  { key: 'branch_opened', label: 'Branch' },
  { key: 'ci_running', label: 'CI' },
  { key: 'review', label: 'Review' },
  { key: 'approved', label: 'Approved' },
  { key: 'deploy_staging', label: 'Staging' },
  { key: 'deploy_prod', label: 'Production' },
  { key: 'verified', label: 'Verified' },
] as const;

type PipelineStage = (typeof PIPELINE_STAGES)[number]['key'];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function prStatusColor(status: string): string {
  if (status === 'failed') return 'border-mc-danger bg-mc-danger/5';
  if (status === 'stalled') return 'border-mc-warning bg-mc-warning/5';
  return 'border-mc-border bg-mc-surface-hover';
}

function prStatusDot(status: string): string {
  if (status === 'failed') return 'bg-mc-danger';
  if (status === 'stalled') return 'bg-mc-warning';
  return 'bg-mc-success';
}

function formatRelativeTime(iso?: string): string | undefined {
  if (!iso) return undefined;
  const timestamp = new Date(iso).getTime();
  if (Number.isNaN(timestamp)) return iso;
  const diffMs = Date.now() - timestamp;
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 60) return `${Math.max(diffMins, 0)}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${Math.floor(diffHours / 24)}d ago`;
}

// ─── Main Component ──────────────────────────────────────────────────────────

interface PipelineSwimlaneProps {
  prs: PipelinePR[];
  deployQueue: DeployQueueItem[];
}

export function PipelineSwimlane({ prs, deployQueue }: PipelineSwimlaneProps) {
  const [selectedPR, setSelectedPR] = useState<PipelinePR | null>(null);

  if (prs.length === 0 && deployQueue.length === 0) {
    return (
      <div className="bg-mc-surface-hover border border-mc-border rounded p-4 flex items-center justify-center py-8">
        <span className="text-xs text-mc-text-tertiary">No active PRs in pipeline</span>
      </div>
    );
  }

  // Group PRs by stage
  const prsByStage: Record<PipelineStage, PipelinePR[]> = {
    issue_created: [],
    branch_opened: [],
    ci_running: [],
    review: [],
    approved: [],
    deploy_staging: [],
    deploy_prod: [],
    verified: [],
  };

  for (const pr of prs) {
    const stage = pr.stage as PipelineStage;
    if (prsByStage[stage]) {
      prsByStage[stage].push(pr);
    }
  }

  return (
    <div>
      {/* Swimlane */}
      <div className="bg-mc-surface-hover border border-mc-border rounded">
        <div className="px-4 py-3 border-b border-mc-border">
          <h3 className="text-xs font-bold uppercase tracking-widest text-mc-text-tertiary">PR Pipeline</h3>
        </div>

        <div className="overflow-x-auto">
          <div className="flex min-w-[900px]">
            {PIPELINE_STAGES.map((stage, idx) => {
              const stagePRs = prsByStage[stage.key];
              const count = stagePRs.length;
              return (
                <div
                  key={stage.key}
                  className={`flex-1 min-w-[112px] ${idx < PIPELINE_STAGES.length - 1 ? 'border-r border-mc-border' : ''}`}
                >
                  <div className="px-2 py-2 border-b border-mc-border/50 flex items-center justify-between">
                    <span className="text-[10px] text-mc-text-tertiary uppercase tracking-wider truncate">{stage.label}</span>
                    {count > 0 && (
                      <span className="text-[10px] font-mono bg-mc-border text-mc-text px-1.5 py-0.5 rounded">
                        {count}
                      </span>
                    )}
                  </div>

                  <div className="p-2 space-y-2 min-h-[120px]">
                    {stagePRs.map(pr => (
                      <button
                        key={pr.id}
                        onClick={() => setSelectedPR(selectedPR?.id === pr.id ? null : pr)}
                        className={`w-full text-left border rounded p-2 transition-colors cursor-pointer ${prStatusColor(pr.status)} ${selectedPR?.id === pr.id ? 'ring-1 ring-mc-info' : 'hover:border-mc-border'}`}
                      >
                        <div className="flex items-center gap-1 mb-1">
                          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${prStatusDot(pr.status)}`} />
                          {pr.number && <span className="text-[10px] font-mono text-mc-info">#{pr.number}</span>}
                        </div>
                        <div className="text-[10px] text-mc-text truncate mb-1" title={pr.title}>
                          {pr.title}
                        </div>
                        <div className="flex items-center justify-between">
                          {pr.author && <span className="text-[10px] text-mc-text-tertiary">{pr.author}</span>}
                          {pr.updatedAt && (
                            <span className={`text-[9px] font-mono ${pr.status === 'stalled' ? 'text-mc-warning' : pr.status === 'failed' ? 'text-mc-danger' : 'text-mc-text-tertiary'}`}>
                              {formatRelativeTime(pr.updatedAt)}
                            </span>
                          )}
                        </div>
                      </button>
                    ))}
                    {stagePRs.length === 0 && (
                      <div className="flex items-center justify-center h-[80px] text-[10px] text-mc-text-tertiary/40">
                        --
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Stage flow arrows */}
        <div className="px-4 py-2 border-t border-mc-border/50 overflow-x-auto">
          <div className="flex items-center min-w-[900px]">
            {PIPELINE_STAGES.map((stage, idx) => (
              <div key={stage.key} className="flex-1 flex items-center justify-center">
                <span className="text-[10px] text-mc-text-tertiary/40 font-mono">
                  {idx < PIPELINE_STAGES.length - 1 ? '-->' : ''}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Detail panel */}
      {selectedPR && (
        <div className="bg-mc-surface-hover border border-mc-border rounded p-4 mt-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              {selectedPR.number && <span className="text-xs font-mono text-mc-info">#{selectedPR.number}</span>}
              <span className="text-sm font-bold text-mc-text">{selectedPR.title}</span>
            </div>
            <button
              onClick={() => setSelectedPR(null)}
              className="text-mc-text-tertiary hover:text-mc-text transition-colors text-sm"
              aria-label="Close detail panel"
            >
              &times;
            </button>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
            {selectedPR.author && (
              <div>
                <div className="text-[10px] text-mc-text-tertiary uppercase mb-1">Author</div>
                <div className="text-mc-text">{selectedPR.author}</div>
              </div>
            )}
            <div>
              <div className="text-[10px] text-mc-text-tertiary uppercase mb-1">Stage</div>
              <div className="flex items-center gap-1.5">
                <span className={`w-2 h-2 rounded-full ${prStatusDot(selectedPR.status)}`} />
                <span className="text-mc-text">
                  {PIPELINE_STAGES.find(s => s.key === selectedPR.stage)?.label ?? selectedPR.stage}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Deploy Queue */}
      {deployQueue.length > 0 && (
        <div className="mt-4 bg-mc-surface-hover border border-mc-border rounded">
          <div className="px-4 py-3 border-b border-mc-border flex items-center justify-between">
            <h3 className="text-xs font-bold uppercase tracking-widest text-mc-text-tertiary">Deploy Queue</h3>
            <span className="text-[10px] font-mono text-mc-text-tertiary">{deployQueue.length} pending</span>
          </div>
          <div className="divide-y divide-mc-border/50">
            {deployQueue.map((item, idx) => (
              <div key={item.id} className="px-4 py-3 flex items-center gap-4">
                <span className="text-[10px] font-mono text-mc-text-tertiary w-4">{idx + 1}</span>
                <div className="flex-1 min-w-0">
                  <span className="text-xs text-mc-text truncate">{item.title}</span>
                  {item.env && (
                    <div className="text-[10px] text-mc-text-tertiary font-mono mt-0.5">{item.env}</div>
                  )}
                </div>
                {item.estimatedAt && (
                  <span className="text-[10px] font-mono text-mc-text-tertiary">{formatRelativeTime(item.estimatedAt)}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
