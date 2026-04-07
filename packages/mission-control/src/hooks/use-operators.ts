import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  Operator,
  OperatorActivity,
  AuditEntry,
  CrossDeptRequest,
  ApprovalDecision,
  TaskLock,
  InviteOperatorResponse,
  ApprovalsPageData,
} from '@/types/operators';

// ── Query keys ──

export const operatorKeys = {
  all: ['operators'] as const,
  list: () => [...operatorKeys.all, 'list'] as const,
  activity: () => [...operatorKeys.all, 'activity'] as const,
  audit: (filters: Record<string, string>) => [...operatorKeys.all, 'audit', filters] as const,
  approvals: () => [...operatorKeys.all, 'approvals'] as const,
  locks: () => [...operatorKeys.all, 'locks'] as const,
};

// ── Fetchers ──

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed (${res.status})`);
  }
  return res.json();
}

// ── Hooks ──

export function useOperators(initialData?: Operator[]) {
  return useQuery({
    queryKey: operatorKeys.list(),
    queryFn: async () => {
      const data = await fetchJson<Operator[] | { operators?: Operator[] }>('/api/operators');
      return Array.isArray(data) ? data : (data as { operators?: Operator[] }).operators ?? [];
    },
    initialData,
  });
}

export function useOperatorActivity(initialData?: OperatorActivity | null) {
  return useQuery({
    queryKey: operatorKeys.activity(),
    queryFn: () => fetchJson<OperatorActivity>('/api/operators/activity'),
    initialData: initialData ?? undefined,
    refetchInterval: 30_000,
  });
}

export function useAuditLog(filters: Record<string, string>) {
  const query = new URLSearchParams(filters).toString();
  return useQuery({
    queryKey: operatorKeys.audit(filters),
    queryFn: () => fetchJson<{ entries: AuditEntry[]; cursor?: string; hasMore?: boolean }>(`/api/operators/audit?${query}`),
  });
}

export function useApprovals(initialData?: ApprovalsPageData) {
  return useQuery({
    queryKey: operatorKeys.approvals(),
    queryFn: () => fetchJson<ApprovalsPageData>('/api/operators/approvals/cross-dept'),
    initialData,
  });
}

export function useLocks(initialData?: { locks: TaskLock[]; note?: string }) {
  return useQuery({
    queryKey: operatorKeys.locks(),
    queryFn: () => fetchJson<{ locks: TaskLock[]; note?: string }>('/api/operators/locks'),
    initialData,
    refetchInterval: 30_000,
  });
}

// ── Mutations ──

export function useApproveRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, note }: { id: string; note?: string }) => {
      const res = await fetch(`/api/operators/approvals/cross-dept/${id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Failed to approve');
      }
      return res.json();
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: operatorKeys.approvals() }); },
  });
}

export function useRejectRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, note }: { id: string; note?: string }) => {
      const res = await fetch(`/api/operators/approvals/cross-dept/${id}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Failed to reject');
      }
      return res.json();
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: operatorKeys.approvals() }); },
  });
}

export function useReleaseLock() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (resourceKey: string) => {
      const res = await fetch(`/api/operators/locks/${encodeURIComponent(resourceKey)}/release`, {
        method: 'POST',
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Failed to release');
      }
      return res.json();
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: operatorKeys.locks() }); },
  });
}
