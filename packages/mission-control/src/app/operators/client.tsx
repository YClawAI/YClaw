'use client';

import { useState, useCallback, useMemo, useRef } from 'react';
import type { Operator, OperatorStatus } from '@/types/operators';
import { TIER_LABELS, TIER_COLORS, STATUS_COLORS } from '@/types/operators';
import { DEPT_META, DEPT_BG_COLORS, type Department } from '@/lib/agents';
import { useOperators } from '@/hooks/use-operators';
import { OperatorDetailDrawer } from '@/components/operator-detail-drawer';
import { InviteOperatorDrawer, type InviteSuccessData } from '@/components/invite-operator-drawer';

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

function StatusDot({ status }: { status: OperatorStatus }) {
  return (
    <span
      className={`inline-block w-2 h-2 rounded-full ${STATUS_COLORS[status]}`}
      title={status}
    />
  );
}

function TierBadge({ tier }: { tier: Operator['tier'] }) {
  return (
    <span
      className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${TIER_COLORS[tier]}`}
    >
      {TIER_LABELS[tier]}
    </span>
  );
}

function DeptTag({ dept }: { dept: string }) {
  const isDept = dept in DEPT_META;
  const bg = isDept ? DEPT_BG_COLORS[dept as Department] : 'bg-mc-border border-mc-border';
  const label = isDept ? DEPT_META[dept as Department].label : dept;
  return (
    <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${bg} text-mc-text`}>
      {label}
    </span>
  );
}

function OperatorRow({
  operator,
  onClick,
}: {
  operator: Operator;
  onClick: () => void;
}) {
  const isInvited = operator.status === 'invited';
  const primaryName = isInvited ? operator.email : operator.displayName;
  const allDepts = operator.departments.length === 6 || operator.tier === 'root';

  return (
    <button
      onClick={onClick}
      className="w-full text-left px-4 py-3 hover:bg-mc-border transition-colors rounded border border-transparent hover:border-mc-border"
    >
      <div className="flex items-center gap-3">
        <StatusDot status={operator.status} />
        <span className="font-mono text-sm text-mc-text font-medium flex-shrink-0">
          {primaryName}
        </span>
        <span className="text-xs text-mc-text-tertiary font-mono">{operator.role}</span>
        <TierBadge tier={operator.tier} />
        <div className="flex-1" />
        <span className="text-[10px] text-mc-text-tertiary font-mono">
          {operator.status === 'revoked'
            ? `revoked ${relativeTime(operator.revokedAt)}`
            : relativeTime(operator.lastActiveAt ?? operator.createdAt)}
        </span>
      </div>
      <div className="flex items-center gap-2 mt-1.5 ml-5">
        {!isInvited && operator.email && (
          <span className="text-[10px] text-mc-text-tertiary font-mono">{operator.email}</span>
        )}
        <div className="flex-1" />
        <div className="flex gap-1.5 flex-wrap justify-end">
          {allDepts ? (
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded border bg-mc-border border-mc-border text-mc-text-tertiary">
              All Departments
            </span>
          ) : (
            operator.departments.map((dept) => (
              <DeptTag key={dept} dept={dept} />
            ))
          )}
        </div>
      </div>
    </button>
  );
}

function StatusGroup({
  label,
  operators,
  onSelect,
}: {
  label: string;
  operators: Operator[];
  onSelect: (op: Operator) => void;
}) {
  if (operators.length === 0) return null;

  return (
    <div className="mb-6">
      <div className="flex items-center gap-2 mb-2 px-1">
        <span className="text-xs font-bold font-mono text-mc-text-tertiary uppercase tracking-wider">
          {label}
        </span>
        <span className="text-[10px] font-mono text-mc-text-tertiary bg-mc-border px-1.5 py-0.5 rounded">
          {operators.length}
        </span>
      </div>
      <div className="border border-mc-border rounded-lg divide-y divide-mc-border bg-mc-surface-hover">
        {operators.map((op) => (
          <OperatorRow
            key={op.operatorId}
            operator={op}
            onClick={() => onSelect(op)}
          />
        ))}
      </div>
    </div>
  );
}

export function OperatorsClient({
  initialOperators,
  initialError,
}: {
  initialOperators: Operator[];
  initialError?: string;
}) {
  const { data: backendOperators, error: queryError, refetch } = useOperators(initialOperators);
  const loadError = queryError
    ? (queryError instanceof Error ? queryError.message : 'Failed to load')
    : initialError;

  // Track synthetic invited entries separately so they survive refetch
  const syntheticInvitesRef = useRef<Operator[]>([]);
  const [, forceUpdate] = useState(0);

  // Merge backend operators with synthetic invites (removing synthetics that appear in backend)
  const operators = useMemo(() => {
    const backend = backendOperators ?? [];
    const backendIds = new Set(backend.map((o) => o.operatorId));
    const filteredSynthetics = syntheticInvitesRef.current.filter(
      (s) => !backendIds.has(s.operatorId),
    );
    return [...backend, ...filteredSynthetics];
  }, [backendOperators]);

  const [selectedOperator, setSelectedOperator] = useState<Operator | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);

  const active = operators.filter((o) => o.status === 'active');
  const invited = operators.filter((o) => o.status === 'invited');
  const suspended = operators.filter((o) => o.status === 'suspended');
  const revoked = operators.filter((o) => o.status === 'revoked');

  const handleOperatorAction = useCallback(async () => {
    setSelectedOperator(null);
    await refetch();
  }, [refetch]);

  const handleInviteSuccess = useCallback((data: InviteSuccessData) => {
    // Add synthetic invited entry that persists across refetch
    // until the backend includes it (e.g., after acceptance)
    syntheticInvitesRef.current = [
      ...syntheticInvitesRef.current,
      {
        operatorId: `invite:${data.response.invitationId}`,
        displayName: data.displayName,
        email: data.email,
        role: data.role,
        tier: data.tier,
        departments: data.departments,
        status: 'invited' as const,
        createdAt: new Date().toISOString(),
      },
    ];
    forceUpdate((n) => n + 1);
  }, []);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-lg font-bold text-mc-text tracking-wide">
          Operators
        </h1>
        <button
          onClick={() => setInviteOpen(true)}
          className="flex items-center gap-2 px-3 py-1.5 text-xs font-mono rounded border border-mc-accent/40 text-mc-accent hover:bg-mc-accent/10 transition-colors"
        >
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
            <path d="M12 5v14M5 12h14" strokeLinecap="round" />
          </svg>
          Invite
        </button>
      </div>

      <StatusGroup label="Active" operators={active} onSelect={setSelectedOperator} />
      <StatusGroup label="Invited" operators={invited} onSelect={setSelectedOperator} />
      <StatusGroup label="Suspended" operators={suspended} onSelect={setSelectedOperator} />
      <StatusGroup label="Revoked" operators={revoked} onSelect={setSelectedOperator} />

      {loadError && (
        <div className="mb-6 px-4 py-3 rounded-lg border border-mc-danger/30 bg-mc-danger/5">
          <div className="text-xs font-mono text-mc-danger font-bold mb-1">Failed to load operators</div>
          <div className="text-xs font-mono text-mc-danger/80">{loadError}</div>
          <button
            onClick={() => refetch()}
            className="mt-2 text-[10px] font-mono text-mc-text border border-mc-border rounded px-2 py-1 hover:bg-mc-border transition-colors"
          >
            Retry
          </button>
        </div>
      )}

      {!loadError && operators.length === 0 && (
        <div className="bg-mc-surface-hover border border-mc-border border-dashed rounded p-6 flex flex-col items-center justify-center gap-2 text-center">
          <span className="text-2xl text-mc-text-tertiary/40">◇</span>
          <div className="text-xs font-bold uppercase tracking-widest text-mc-text-tertiary/60">
            No operators
          </div>
          <p className="text-[10px] text-mc-text-tertiary/40 max-w-xs">
            Your roster is empty. Invite an operator to get started.
          </p>
        </div>
      )}

      <OperatorDetailDrawer
        operator={selectedOperator}
        open={selectedOperator !== null}
        onClose={() => setSelectedOperator(null)}
        onAction={handleOperatorAction}
      />

      <InviteOperatorDrawer
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        onSuccess={handleInviteSuccess}
      />
    </div>
  );
}
