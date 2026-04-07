export const dynamic = 'force-dynamic';

import { fetchCoreApi } from '@/lib/core-api';
import { AuditClient } from './client';
import type { AuditEntry } from '@/types/operators';

interface BackendAuditEntry {
  timestamp: string;
  operatorId: string;
  action: string;
  departmentId?: string;
  resource?: { type?: string; id?: string };
  request?: { method?: string; path?: string; ip?: string };
  decision?: 'allowed' | 'denied';
  reason?: string;
}

function normalizeEntry(raw: BackendAuditEntry, index: number): AuditEntry {
  return {
    id: `${raw.timestamp}-${raw.operatorId}-${index}`,
    timestamp: raw.timestamp,
    operatorId: raw.operatorId,
    action: raw.action,
    department: raw.departmentId,
    target: raw.resource?.id ? `${raw.resource.type ?? 'resource'}:${raw.resource.id}` : undefined,
    decision: raw.decision,
    denialReason: raw.decision === 'denied' ? raw.reason : undefined,
    ip: raw.request?.ip,
  };
}

export default async function AuditPage() {
  let initialEntries: AuditEntry[] | undefined;
  try {
    const result = await fetchCoreApi<{ entries?: BackendAuditEntry[] }>('/v1/audit');
    if (result.ok && result.data?.entries) {
      initialEntries = result.data.entries.slice(0, 50).map(normalizeEntry);
    }
  } catch {
    // Client will fetch on its own
  }

  return <AuditClient initialEntries={initialEntries} />;
}
