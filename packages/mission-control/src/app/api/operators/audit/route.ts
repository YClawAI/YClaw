export const dynamic = 'force-dynamic';

import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { fetchCoreApi } from '@/lib/core-api';
import { requireSession, checkTier } from '@/lib/require-permission';
import type { AuditEntry } from '@/types/operators';

// Backend audit entry shape (from audit-logger.ts)
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

/** Normalize backend audit entry to the UI shape */
function normalizeEntry(raw: BackendAuditEntry, index: number): AuditEntry {
  return {
    id: `${raw.timestamp}-${raw.operatorId}-${index}`,
    timestamp: raw.timestamp,
    operatorId: raw.operatorId,
    action: raw.action,
    department: raw.departmentId,
    target: raw.resource?.id
      ? `${raw.resource.type ?? 'resource'}:${raw.resource.id}`
      : undefined,
    decision: raw.decision,
    denialReason: raw.decision === 'denied' ? raw.reason : undefined,
    ip: raw.request?.ip,
  };
}

export async function GET(req: NextRequest) {
  const auth = await requireSession();
  if (auth.error) return auth.error;

  // department_head+ can view audit logs
  const denied = checkTier(auth.session, 'department_head');
  if (denied) return denied;

  // Fetch all entries from backend (no pagination support there)
  const result = await fetchCoreApi<{ entries?: BackendAuditEntry[]; count?: number }>(
    '/v1/audit',
  );
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error || 'Failed to fetch audit log' },
      { status: result.status || 502 },
    );
  }

  const rawEntries = result.data?.entries ?? [];
  let entries = rawEntries.map(normalizeEntry);

  // ── Client-side filtering (backend doesn't support these params) ──
  const { searchParams } = req.nextUrl;

  const operatorId = searchParams.get('operatorId');
  if (operatorId) {
    entries = entries.filter((e) => e.operatorId === operatorId);
  }

  const action = searchParams.get('action');
  if (action) {
    entries = entries.filter((e) => e.action === action);
  }

  const department = searchParams.get('department');
  if (department) {
    entries = entries.filter((e) => e.department === department);
  }

  const from = searchParams.get('from');
  if (from) {
    const fromTime = new Date(from).getTime();
    entries = entries.filter((e) => new Date(e.timestamp).getTime() >= fromTime);
  }

  const to = searchParams.get('to');
  if (to) {
    const toTime = new Date(to).getTime() + 86400000; // end of day
    entries = entries.filter((e) => new Date(e.timestamp).getTime() < toTime);
  }

  const deniedOnly = searchParams.get('deniedOnly');
  if (deniedOnly === 'true') {
    entries = entries.filter((e) => e.decision === 'denied');
  }

  // ── Cursor-based pagination (implemented at proxy layer) ──
  const limit = parseInt(searchParams.get('limit') || '50', 10);
  const cursor = searchParams.get('cursor');
  let startIndex = 0;
  if (cursor) {
    const cursorIndex = parseInt(cursor, 10);
    if (!isNaN(cursorIndex)) startIndex = cursorIndex;
  }

  const page = entries.slice(startIndex, startIndex + limit);
  const nextCursor = startIndex + limit < entries.length ? String(startIndex + limit) : undefined;

  return NextResponse.json({
    entries: page,
    cursor: nextCursor,
    hasMore: nextCursor !== undefined,
    totalCount: entries.length,
  });
}
