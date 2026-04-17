'use client';

import { useState, useCallback } from 'react';
import Link from 'next/link';
import type { CrossDeptRequest, ApprovalDecision, ApprovalsPageData } from '@/types/operators';
import { DEPT_META, DEPT_COLORS, type Department } from '@/lib/agents';
import { useApprovals, useApproveRequest, useRejectRequest } from '@/hooks/use-operators';
import { useToastStore } from '@/stores/toast-store';
import { ChevronDown, ChevronRight, CheckIcon, XIcon } from '@/components/icons';

function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  if (diff < 0) return 'just now';
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function timeUntil(dateStr: string): string {
  const diff = new Date(dateStr).getTime() - Date.now();
  if (diff <= 0) return 'expired';
  const hours = Math.floor(diff / 3600000);
  const minutes = Math.floor((diff % 3600000) / 60000);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function deptColor(dept: string): string {
  if (dept in DEPT_COLORS) return DEPT_COLORS[dept as Department];
  return 'text-mc-text';
}

function deptLabel(dept: string): string {
  if (dept in DEPT_META) return DEPT_META[dept as Department].label;
  return dept;
}

function PendingCard({
  request,
  onApprove,
  onReject,
}: {
  request: CrossDeptRequest;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
}) {
  return (
    <div className="px-4 py-4 border-b border-mc-border last:border-b-0">
      <div className="flex items-start gap-3 mb-2">
        <span className="text-[10px] text-mc-text-tertiary font-mono shrink-0">{request.requestId}</span>
        <div className="flex-1">
          <div className="text-xs font-mono text-mc-text">
            <span className="font-medium">{request.requestingOperatorName}</span>
            <span className="text-mc-text-tertiary"> ({request.requesterTier})</span>
            <span className="text-mc-text-tertiary"> → </span>
            <span className={deptColor(request.targetDepartment)}>{deptLabel(request.targetDepartment)}</span>
            <span className="text-mc-text-tertiary"> / </span>
            <span className="text-mc-text">{request.targetAgent}</span>
          </div>
          <p className="text-[10px] font-mono text-mc-text-tertiary mt-1">
            &ldquo;{request.reason}&rdquo;
          </p>
        </div>
      </div>
      <div className="flex items-center justify-between mt-2">
        <div className="text-[10px] font-mono text-mc-text-tertiary">
          Submitted {relativeTime(request.createdAt)}
          <span className="mx-1.5">·</span>
          Expires in {timeUntil(request.expiresAt)}
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => onApprove(request.requestId)}
            className="px-3 py-1 text-[10px] font-mono rounded border border-mc-success/40 text-mc-success hover:bg-mc-success/10 transition-colors"
          >
            Approve
          </button>
          <button
            onClick={() => onReject(request.requestId)}
            className="px-3 py-1 text-[10px] font-mono rounded border border-mc-danger/30 text-mc-danger hover:bg-mc-danger/10 transition-colors"
          >
            Reject
          </button>
        </div>
      </div>
    </div>
  );
}

function DecisionRow({ decision }: { decision: ApprovalDecision }) {
  const isApproved = decision.action === 'cross_dept.approve';
  return (
    <div className="px-4 py-3 border-b border-mc-border last:border-b-0">
      <div className="flex items-start gap-2">
        <span className={`mt-0.5 ${isApproved ? 'text-mc-success' : 'text-mc-danger'}`}>
          {isApproved ? <CheckIcon /> : <XIcon />}
        </span>
        <div className="flex-1">
          <div className="text-xs font-mono text-mc-text">
            {decision.requestId && (
              <span className="text-[10px] text-mc-text-tertiary mr-1">{decision.requestId}</span>
            )}
            <span className={isApproved ? 'text-mc-success' : 'text-mc-danger'}>
              {isApproved ? 'Approved' : 'Rejected'}
            </span>
            <span className="text-mc-text-tertiary"> by {decision.decidedBy}</span>
          </div>
          {decision.note && (
            <div className="text-[10px] font-mono text-mc-text-tertiary mt-0.5">
              &ldquo;{decision.note}&rdquo;
            </div>
          )}
          <div className="text-[10px] font-mono text-mc-text-tertiary mt-0.5">
            {relativeTime(decision.timestamp)}
            {decision.resultingTaskId && (
              <Link
                href={`/system/queues?task=${decision.resultingTaskId}`}
                className="ml-2 text-mc-success hover:text-mc-success/80 transition-colors"
              >
                → Task {decision.resultingTaskId}
              </Link>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export function ApprovalsClient({ initialData }: { initialData?: ApprovalsPageData }) {
  const { data, error, isLoading } = useApprovals(initialData);
  const approveMutation = useApproveRequest();
  const rejectMutation = useRejectRequest();
  const addToast = useToastStore((s) => s.add);

  const pending = data?.pending ?? [];
  const decisions = data?.recentDecisions ?? [];

  // Action dialog state
  const [actionType, setActionType] = useState<'approve' | 'reject' | null>(null);
  const [actionId, setActionId] = useState<string | null>(null);
  const [actionNote, setActionNote] = useState('');

  const openApprove = (id: string) => { setActionType('approve'); setActionId(id); setActionNote(''); };
  const openReject = (id: string) => { setActionType('reject'); setActionId(id); setActionNote(''); };
  const closeAction = () => { setActionType(null); setActionId(null); setActionNote(''); };

  const selectedRequest = pending.find((r) => r.requestId === actionId);
  const actionLoading = approveMutation.isPending || rejectMutation.isPending;

  const handleAction = useCallback(async () => {
    if (!actionId || !actionType) return;
    try {
      if (actionType === 'approve') {
        const result = await approveMutation.mutateAsync({ id: actionId, note: actionNote || undefined });
        addToast('success', `Approved — Task ${result.resultingTaskId ?? ''} created`);
      } else {
        await rejectMutation.mutateAsync({ id: actionId, note: actionNote || undefined });
        addToast('success', 'Request rejected');
      }
      closeAction();
    } catch (err) {
      addToast('error', err instanceof Error ? err.message : 'Action failed');
    }
  }, [actionId, actionType, actionNote, approveMutation, rejectMutation, addToast]);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-lg font-bold text-mc-text tracking-wide">
          Cross-Department Requests
        </h1>
        {pending.length > 0 && (
          <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-mc-danger/10 border border-mc-danger/30 text-mc-danger">
            Pending: {pending.length}
          </span>
        )}
      </div>

      {error && (
        <div className="mb-6 px-4 py-3 rounded-lg border border-mc-danger/30 bg-mc-danger/5">
          <div className="text-xs font-mono text-mc-danger">{error instanceof Error ? error.message : 'Failed to load'}</div>
        </div>
      )}

      {isLoading && !error && (
        <div className="text-center py-16 text-mc-text-tertiary text-xs font-mono">Loading...</div>
      )}

      {/* Pending */}
      {!isLoading && pending.length > 0 && (
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-2 px-1">
            <span className="text-xs font-bold font-mono text-mc-text-tertiary uppercase tracking-wider">Pending</span>
            <span className="text-[10px] font-mono text-mc-text-tertiary bg-mc-border px-1.5 py-0.5 rounded">{pending.length}</span>
          </div>
          <div className="border border-mc-border rounded-lg bg-mc-surface-hover">
            {pending.map((r) => (
              <PendingCard key={r.requestId} request={r} onApprove={openApprove} onReject={openReject} />
            ))}
          </div>
        </div>
      )}

      {!isLoading && pending.length === 0 && !error && (
        <div className="mb-6 text-center py-8 text-mc-text-tertiary text-xs font-mono border border-mc-border rounded-lg bg-mc-surface-hover">
          No pending cross-department requests
        </div>
      )}

      {/* Recent Decisions */}
      {!isLoading && decisions.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-2 px-1">
            <span className="text-xs font-bold font-mono text-mc-text-tertiary uppercase tracking-wider">Recent Decisions</span>
            <span className="text-[10px] font-mono text-mc-text-tertiary bg-mc-border px-1.5 py-0.5 rounded">{decisions.length}</span>
          </div>
          <div className="border border-mc-border rounded-lg bg-mc-surface-hover">
            {decisions.map((d) => (
              <DecisionRow key={d.id} decision={d} />
            ))}
          </div>
        </div>
      )}

      {/* Approve/Reject Confirmation Overlay */}
      {actionType && selectedRequest && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-mc-surface-hover border border-mc-border rounded-lg shadow-2xl p-6 max-w-md w-full mx-4">
            <h3 className="text-sm font-bold font-mono text-mc-text mb-3">
              {actionType === 'approve' ? 'Approve Request' : 'Reject Request'}
            </h3>
            <div className="text-xs font-mono text-mc-text-tertiary mb-1">
              {selectedRequest.requestingOperatorName} → {deptLabel(selectedRequest.targetDepartment)} / {selectedRequest.targetAgent}
            </div>
            <div className="text-[10px] font-mono text-mc-text-tertiary mb-4">
              &ldquo;{selectedRequest.reason}&rdquo;
            </div>
            <div className="mb-4">
              <label className="text-[10px] text-mc-text-tertiary font-mono block mb-1">
                {actionType === 'reject' ? 'Reason *' : 'Note (optional)'}
              </label>
              <input
                type="text"
                value={actionNote}
                onChange={(e) => setActionNote(e.target.value)}
                placeholder={actionType === 'approve' ? 'Approved — priority Q2 work' : 'Reason for rejection...'}
                className="w-full px-3 py-1.5 text-xs font-mono rounded border border-mc-border bg-mc-bg text-mc-text placeholder:text-mc-text-tertiary/50 focus:outline-none focus:border-mc-accent/50"
              />
            </div>
            <div className="flex gap-2 justify-end">
              <button
                onClick={closeAction}
                disabled={actionLoading}
                className="px-3 py-1.5 text-xs font-mono rounded border border-mc-border text-mc-text-tertiary hover:text-mc-text transition-colors"
              >
                Cancel
              </button>
              {actionType === 'approve' ? (
                <button
                  onClick={handleAction}
                  disabled={actionLoading}
                  className="px-3 py-1.5 text-xs font-mono rounded border border-mc-success/50 bg-mc-success/10 text-mc-success hover:bg-mc-success/20 transition-colors disabled:opacity-50"
                >
                  {actionLoading ? 'Approving...' : 'Approve & Create Task'}
                </button>
              ) : (
                <button
                  onClick={handleAction}
                  disabled={actionLoading || !actionNote.trim()}
                  className="px-3 py-1.5 text-xs font-mono rounded border border-mc-danger/50 bg-mc-danger/10 text-mc-danger hover:bg-mc-danger/20 transition-colors disabled:opacity-50"
                >
                  {actionLoading ? 'Rejecting...' : 'Reject'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
