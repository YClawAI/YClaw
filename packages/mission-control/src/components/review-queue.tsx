'use client';

import { useState, useEffect, useTransition } from 'react';
import { decideApproval } from '@/lib/actions/approval-actions';
import type { ApprovalItem } from '@/lib/approvals-queries';

interface ReviewQueueProps {
  items: ApprovalItem[];
  fleetOnline?: boolean;
}

const COLUMN_HEADERS: Record<string, { label: string; color: string; borderColor: string }> = {
  pending: { label: 'Pending', color: 'text-mc-warning', borderColor: 'border-mc-warning/30' },
  approved: { label: 'Approved', color: 'text-mc-success', borderColor: 'border-mc-success/30' },
  rejected: { label: 'Rejected', color: 'text-mc-danger', borderColor: 'border-mc-danger/30' },
};

function formatRelativeTime(iso: string): string {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 0) return 'just now';
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

function Repobadge({ repo }: { repo: string }) {
  // Show just the repo name (strip owner/ prefix if present)
  const shortName = repo.includes('/') ? repo.split('/').pop() : repo;
  return (
    <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-mc-info/10 text-mc-info border border-mc-info/20 truncate max-w-[120px]">
      {shortName}
    </span>
  );
}

export function ReviewQueue({ items, fleetOnline = false }: ReviewQueueProps) {
  const [tooltipId, setTooltipId] = useState<string | null>(null);
  const [localItems, setLocalItems] = useState<ApprovalItem[]>(items);
  // Sync localItems when server-rendered items prop changes
  useEffect(() => {
    setLocalItems(items);
  }, [items]);
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);
  const [actionError, setActionError] = useState<{ id: string; message: string } | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const columns = ['pending', 'approved', 'rejected'] as const;

  function handleDecision(approvalId: string, itemId: string, decision: 'approve' | 'reject') {
    // For approve, require a confirmation step
    if (decision === 'approve' && confirmingId !== itemId) {
      setConfirmingId(itemId);
      return;
    }
    setConfirmingId(null);
    setActionError(null);
    setActionInProgress(itemId);
    startTransition(async () => {
      const result = await decideApproval(approvalId, decision);
      setActionInProgress(null);
      if (result.ok) {
        // Update local state to reflect the decision
        setLocalItems((prev) =>
          prev.map((item) =>
            item.id === itemId
              ? { ...item, status: decision === 'approve' ? 'approved' : 'rejected' }
              : item
          )
        );
      } else {
        setActionError({ id: itemId, message: result.error ?? 'Action failed' });
      }
    });
  }

  // Map flagged status to rejected column for display
  const getColumnItems = (col: string) => {
    if (col === 'rejected') {
      return localItems.filter((item) => item.status === 'rejected' || item.status === 'flagged');
    }
    return localItems.filter((item) => item.status === col);
  };

  if (localItems.length === 0) {
    return (
      <div className="bg-mc-surface-hover border border-mc-border border-dashed rounded p-6 flex flex-col items-center justify-center gap-2 text-center">
        <span className="text-2xl text-mc-text-tertiary/40">◇</span>
        <div className="text-xs font-bold uppercase tracking-widest text-mc-text-tertiary/60">
          Review queue empty
        </div>
        <p className="text-[10px] text-mc-text-tertiary/40 max-w-xs">
          No items awaiting approval. Flagged agent output appears here for operator review.
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      {columns.map((col) => {
        const colItems = getColumnItems(col);
        const header = COLUMN_HEADERS[col];
        return (
          <div key={col} className="flex flex-col">
            {/* Column header */}
            <div className={`flex items-center justify-between px-3 py-2 border-b-2 ${header.borderColor} mb-3`}>
              <span className={`text-xs font-bold uppercase tracking-widest ${header.color}`}>
                {header.label}
              </span>
              <span className="text-[10px] font-mono text-mc-text-tertiary">
                {colItems.length}
              </span>
            </div>

            {/* Column cards */}
            <div className="space-y-2 flex-1">
              {colItems.length === 0 ? (
                <div className="text-[10px] text-mc-text-tertiary text-center py-6">
                  No items
                </div>
              ) : (
                colItems.map((item) => (
                  <div
                    key={item.id}
                    className="bg-mc-surface-hover border border-mc-border rounded p-3 hover:border-mc-border transition-colors"
                  >
                    {/* Title row */}
                    <div className="flex items-start justify-between gap-2 mb-1.5">
                      <span className="text-xs text-mc-text font-medium line-clamp-2 flex-1">
                        {item.title}
                      </span>
                    </div>

                    {/* Description preview */}
                    {item.description && item.description !== item.title && (
                      <p className="text-[10px] text-mc-text-tertiary line-clamp-2 mb-2 leading-relaxed">
                        {item.description}
                      </p>
                    )}

                    {/* Metadata row: repo badge, PR number, agent, time */}
                    <div className="flex items-center gap-2 flex-wrap">
                      {item.repo && <Repobadge repo={item.repo} />}
                      {item.prNumber && (
                        <span className="text-[10px] font-mono text-mc-text-tertiary">
                          #{item.prNumber}
                        </span>
                      )}
                      {item.agentId && (
                        <span className="text-[10px] text-mc-text-tertiary font-mono">{item.agentId}</span>
                      )}
                      {item.createdAt && (
                        <span className="text-[10px] text-mc-text-tertiary font-mono ml-auto">
                          {formatRelativeTime(item.createdAt)}
                        </span>
                      )}
                    </div>

                    {/* Action buttons for pending items */}
                    {col === 'pending' && (
                      <div className="mt-2 pt-2 border-t border-mc-border space-y-1.5">
                        <div className="flex items-center gap-2">
                          <div className="relative">
                            <button
                              className={`px-2 py-1 text-[10px] font-mono rounded border transition-colors ${
                                fleetOnline
                                  ? 'border-mc-success/40 text-mc-success hover:bg-mc-success/10'
                                  : 'border-mc-success/30 text-mc-success/50 cursor-not-allowed'
                              }`}
                              onMouseEnter={() => { if (!fleetOnline) setTooltipId(`approve-${item.id}`); }}
                              onMouseLeave={() => setTooltipId(null)}
                              disabled={!fleetOnline || actionInProgress === item.id}
                              onClick={() => handleDecision(item.id, item.id, 'approve')}
                            >
                              {actionInProgress === item.id ? '...' : confirmingId === item.id ? 'Confirm Approve?' : 'Approve'}
                            </button>
                            {tooltipId === `approve-${item.id}` && !fleetOnline && (
                              <div className="absolute bottom-full left-0 mb-1 px-2 py-1 text-[9px] font-mono bg-mc-bg border border-mc-border rounded text-mc-text-tertiary whitespace-nowrap z-10">
                                Unavailable
                              </div>
                            )}
                          </div>
                          <div className="relative">
                            <button
                              className={`px-2 py-1 text-[10px] font-mono rounded border transition-colors ${
                                fleetOnline
                                  ? 'border-mc-danger/40 text-mc-danger hover:bg-mc-danger/10'
                                  : 'border-mc-danger/30 text-mc-danger/50 cursor-not-allowed'
                              }`}
                              onMouseEnter={() => { if (!fleetOnline) setTooltipId(`reject-${item.id}`); }}
                              onMouseLeave={() => setTooltipId(null)}
                              disabled={!fleetOnline || actionInProgress === item.id}
                              onClick={() => { setConfirmingId(null); handleDecision(item.id, item.id, 'reject'); }}
                            >
                              {actionInProgress === item.id ? '...' : 'Reject'}
                            </button>
                            {tooltipId === `reject-${item.id}` && !fleetOnline && (
                              <div className="absolute bottom-full left-0 mb-1 px-2 py-1 text-[9px] font-mono bg-mc-bg border border-mc-border rounded text-mc-text-tertiary whitespace-nowrap z-10">
                                Unavailable
                              </div>
                            )}
                          </div>
                          {confirmingId === item.id && (
                            <button
                              className="px-2 py-1 text-[10px] font-mono text-mc-text-tertiary hover:text-mc-text"
                              onClick={() => setConfirmingId(null)}
                            >
                              Cancel
                            </button>
                          )}
                        </div>
                        {actionError?.id === item.id && (
                          <div className="text-[10px] font-mono text-mc-danger bg-mc-danger/10 border border-mc-danger/30 rounded px-2 py-1">
                            {actionError.message}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
