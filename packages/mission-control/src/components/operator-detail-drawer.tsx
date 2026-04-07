'use client';

import { useState, useCallback } from 'react';
import { SettingsDrawer } from './settings-drawer';
import type { Operator } from '@/types/operators';
import { TIER_LABELS, TIER_COLORS, STATUS_COLORS } from '@/types/operators';
import { DEPT_META, DEPT_BG_COLORS, type Department } from '@/lib/agents';
import { revokeOperator, rotateOperatorKey } from '@/lib/operators-api';

function relativeTime(dateStr: string | undefined): string {
  if (!dateStr) return 'never';
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

function formatDate(dateStr: string | undefined): string {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-[10px] font-bold uppercase tracking-widest text-terminal-dim/60 mb-3 mt-6 first:mt-0">
      {children}
    </h3>
  );
}

function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between py-1.5">
      <span className="text-xs text-terminal-dim font-mono">{label}</span>
      <span className="text-xs text-terminal-text font-mono text-right max-w-[60%]">{children}</span>
    </div>
  );
}

interface Props {
  operator: Operator | null;
  open: boolean;
  onClose: () => void;
  onAction: () => void;
}

export function OperatorDetailDrawer({ operator, open, onClose, onAction }: Props) {
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const [revokeReason, setRevokeReason] = useState('');
  const [confirmRotate, setConfirmRotate] = useState(false);
  const [newApiKey, setNewApiKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const resetState = useCallback(() => {
    setConfirmRevoke(false);
    setRevokeReason('');
    setConfirmRotate(false);
    setNewApiKey(null);
    setLoading(false);
    setError(null);
    setCopied(false);
  }, []);

  const handleClose = useCallback(() => {
    resetState();
    onClose();
  }, [resetState, onClose]);

  const handleRevoke = useCallback(async () => {
    if (!operator) return;
    setLoading(true);
    setError(null);
    try {
      await revokeOperator(operator.operatorId, revokeReason || 'Revoked via Mission Control');
      resetState();
      onAction();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to revoke');
    } finally {
      setLoading(false);
    }
  }, [operator, revokeReason, resetState, onAction]);

  const handleRotate = useCallback(async () => {
    if (!operator) return;
    setLoading(true);
    setError(null);
    try {
      const result = await rotateOperatorKey(operator.operatorId);
      setNewApiKey(result.apiKey);
      setConfirmRotate(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to rotate key');
    } finally {
      setLoading(false);
    }
  }, [operator]);

  const copyToClipboard = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback
    }
  }, []);

  if (!operator) return null;

  const isRoot = operator.tier === 'root';
  const isRevoked = operator.status === 'revoked';
  const allDepts = operator.departments.length === 6 || isRoot;
  const showActions = !isRoot && !isRevoked;

  return (
    <SettingsDrawer
      open={open}
      onClose={handleClose}
      title={operator.displayName || operator.email}
    >
      {/* ── Identity ── */}
      <SectionHeader>Identity</SectionHeader>
      <div className="space-y-0.5">
        <InfoRow label="Name">{operator.displayName}</InfoRow>
        <InfoRow label="Email">{operator.email}</InfoRow>
        <InfoRow label="Role">{operator.role}</InfoRow>
        <InfoRow label="Tier">
          <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${TIER_COLORS[operator.tier]}`}>
            {TIER_LABELS[operator.tier]}
          </span>
        </InfoRow>
        <InfoRow label="Status">
          <span className="flex items-center gap-1.5">
            <span className={`inline-block w-2 h-2 rounded-full ${STATUS_COLORS[operator.status]}`} />
            <span className="capitalize">{operator.status}</span>
          </span>
        </InfoRow>
        {operator.openClaw && (
          <>
            <InfoRow label="OpenClaw Agent">{operator.openClaw.agentName}</InfoRow>
            {operator.openClaw.instanceLabel && (
              <InfoRow label="Instance">{operator.openClaw.instanceLabel}</InfoRow>
            )}
          </>
        )}
        <InfoRow label="Created">{formatDate(operator.createdAt)}</InfoRow>
        <InfoRow label="Last Active">
          {operator.lastActiveAt
            ? `${relativeTime(operator.lastActiveAt)} (${formatDate(operator.lastActiveAt)})`
            : '—'}
        </InfoRow>
        {operator.revokedAt && (
          <>
            <InfoRow label="Revoked">{formatDate(operator.revokedAt)}</InfoRow>
            {operator.revokedReason && (
              <InfoRow label="Reason">{operator.revokedReason}</InfoRow>
            )}
          </>
        )}
        {isRoot && (
          <div className="mt-3 px-3 py-2 rounded border border-terminal-purple/30 bg-terminal-purple/5">
            <span className="text-[10px] font-mono text-terminal-purple font-bold uppercase tracking-wider">
              System Root
            </span>
          </div>
        )}
      </div>

      {/* ── Access ── */}
      <SectionHeader>Access</SectionHeader>
      <div className="space-y-0.5">
        {operator.priorityClass != null && (
          <InfoRow label="Priority Class">{operator.priorityClass}</InfoRow>
        )}
        {operator.limits ? (
          <>
            <InfoRow label="RPM Limit">{operator.limits.requestsPerMinute}</InfoRow>
            <InfoRow label="Concurrent Tasks">{operator.limits.maxConcurrentTasks}</InfoRow>
            <InfoRow label="Daily Quota">{operator.limits.dailyTaskQuota}</InfoRow>
          </>
        ) : (
          <span className="text-[10px] text-terminal-dim font-mono">Rate limits not available in summary view</span>
        )}
      </div>
      <div className="mt-3">
        <span className="text-xs text-terminal-dim font-mono block mb-2">Departments</span>
        <div className="flex gap-1.5 flex-wrap">
          {allDepts ? (
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded border bg-terminal-muted border-terminal-border text-terminal-dim">
              All Departments
            </span>
          ) : (
            operator.departments.map((dept) => {
              const isDept = dept in DEPT_META;
              const bg = isDept ? DEPT_BG_COLORS[dept as Department] : 'bg-terminal-muted border-terminal-border';
              const label = isDept ? DEPT_META[dept as Department].label : dept;
              return (
                <span key={dept} className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${bg} text-terminal-text`}>
                  {label}
                </span>
              );
            })
          )}
        </div>
      </div>

      {/* ── New API Key Display ── */}
      {newApiKey && (
        <div className="mt-6 border border-terminal-yellow/40 rounded-lg bg-terminal-yellow/5 p-4">
          <div className="text-xs font-mono font-bold text-terminal-yellow mb-2">New API Key</div>
          <div className="flex items-center gap-2 mb-3">
            <code className="flex-1 text-xs font-mono text-terminal-text bg-terminal-muted px-2 py-1.5 rounded border border-terminal-border break-all">
              {newApiKey}
            </code>
            <button
              onClick={() => copyToClipboard(newApiKey)}
              className="shrink-0 px-2 py-1.5 text-[10px] font-mono rounded border border-terminal-border text-terminal-dim hover:text-terminal-text hover:bg-terminal-muted transition-colors"
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <p className="text-[10px] text-terminal-yellow/80 font-mono">
            This key will only be shown once. Store it securely.
          </p>
        </div>
      )}

      {/* ── Actions ── */}
      {showActions && (
        <>
          <SectionHeader>Actions</SectionHeader>

          {error && (
            <div className="mb-3 px-3 py-2 rounded border border-terminal-red/30 bg-terminal-red/5 text-xs text-terminal-red font-mono">
              {error}
            </div>
          )}

          {/* Rotate Key */}
          {!confirmRotate && !newApiKey && (
            <button
              onClick={() => setConfirmRotate(true)}
              disabled={loading}
              className="w-full mb-3 px-3 py-2 text-xs font-mono rounded border border-terminal-border text-terminal-text hover:bg-terminal-muted transition-colors disabled:opacity-50"
            >
              Rotate API Key
            </button>
          )}
          {confirmRotate && (
            <div className="mb-3 p-3 rounded border border-terminal-yellow/30 bg-terminal-yellow/5">
              <p className="text-xs text-terminal-text font-mono mb-3">
                This will invalidate the current API key. The operator will need the new key to authenticate.
              </p>
              <div className="flex gap-2">
                <button
                  onClick={handleRotate}
                  disabled={loading}
                  className="flex-1 px-3 py-1.5 text-xs font-mono rounded border border-terminal-yellow/40 text-terminal-yellow hover:bg-terminal-yellow/10 transition-colors disabled:opacity-50"
                >
                  {loading ? 'Rotating...' : 'Confirm Rotate'}
                </button>
                <button
                  onClick={() => setConfirmRotate(false)}
                  disabled={loading}
                  className="px-3 py-1.5 text-xs font-mono rounded border border-terminal-border text-terminal-dim hover:text-terminal-text transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Revoke */}
          {!confirmRevoke && (
            <button
              onClick={() => setConfirmRevoke(true)}
              disabled={loading}
              className="w-full px-3 py-2 text-xs font-mono rounded border border-terminal-red/30 text-terminal-red hover:bg-terminal-red/10 transition-colors disabled:opacity-50"
            >
              Revoke Access
            </button>
          )}
          {confirmRevoke && (
            <div className="p-3 rounded border border-terminal-red/30 bg-terminal-red/5">
              <p className="text-xs text-terminal-text font-mono mb-3">
                This will immediately revoke all access for this operator. This action cannot be undone.
              </p>
              <input
                type="text"
                placeholder="Reason for revocation..."
                value={revokeReason}
                onChange={(e) => setRevokeReason(e.target.value)}
                className="w-full mb-3 px-3 py-1.5 text-xs font-mono rounded border border-terminal-border bg-terminal-bg text-terminal-text placeholder:text-terminal-dim/50 focus:outline-none focus:border-terminal-red/50"
              />
              <div className="flex gap-2">
                <button
                  onClick={handleRevoke}
                  disabled={loading}
                  className="flex-1 px-3 py-1.5 text-xs font-mono rounded border border-terminal-red/50 bg-terminal-red/10 text-terminal-red hover:bg-terminal-red/20 transition-colors disabled:opacity-50"
                >
                  {loading ? 'Revoking...' : 'Confirm Revoke'}
                </button>
                <button
                  onClick={() => {
                    setConfirmRevoke(false);
                    setRevokeReason('');
                  }}
                  disabled={loading}
                  className="px-3 py-1.5 text-xs font-mono rounded border border-terminal-border text-terminal-dim hover:text-terminal-text transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </SettingsDrawer>
  );
}
