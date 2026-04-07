import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { requireSession, checkTier } from '@/lib/require-permission';
import type { AuditEvent } from '@/components/audit/audit-types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TIME_RANGES: Record<string, number> = {
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
};

export async function GET(req: NextRequest) {
  const auth = await requireSession();
  if (auth.error) return auth.error;
  const denied = checkTier(auth.session, 'department_head');
  if (denied) return denied;

  const params = req.nextUrl.searchParams;
  const timeRange = params.get('timeRange') || '24h';
  const types = params.get('types')?.split(',').filter(Boolean);
  const agents = params.get('agents')?.split(',').filter(Boolean);
  const severities = params.get('severities')?.split(',').filter(Boolean);
  const search = params.get('search');
  const parsedLimit = parseInt(params.get('limit') || '500');
  const limit = Number.isNaN(parsedLimit) ? 500 : Math.min(parsedLimit, 1000);

  const since = new Date(Date.now() - (TIME_RANGES[timeRange] || TIME_RANGES['24h']!));

  try {
    const db = await getDb();
    if (!db) return NextResponse.json([]);
    const fetchLimit = Math.min(limit * 3, 1000);
    const [auditEvents, orgSettingsAudit, auditLog] = await Promise.all([
      db.collection('audit_events').find({}).sort({ timestamp: -1 }).limit(fetchLimit).toArray(),
      db.collection('org_settings_audit').find({}).sort({ timestamp: -1 }).limit(fetchLimit).toArray(),
      db.collection('audit_log').find({}).sort({ timestamp: -1 }).limit(fetchLimit).toArray(),
    ]);

    const mapped: AuditEvent[] = [
      ...auditEvents.map(mapPrimaryAuditEvent),
      ...orgSettingsAudit.map(mapOrgSettingsAuditEvent),
      ...auditLog.map(mapAuditLogEvent),
    ]
      .filter((event) => new Date(event.timestamp).getTime() >= since.getTime())
      .filter((event) => !types?.length || types.includes(event.type))
      .filter((event) => !agents?.length || (event.agentId ? agents.includes(event.agentId) : false))
      .filter((event) => !severities?.length || severities.includes(event.severity))
      .filter((event) => {
        if (!search) return true;
        const query = search.toLowerCase();
        return event.title.toLowerCase().includes(query) || (event.detail ?? '').toLowerCase().includes(query);
      })
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, limit);

    return NextResponse.json(mapped);
  } catch (err) {
    console.error('[audit] MongoDB query error:', err);
    return NextResponse.json([], { status: 500 });
  }
}

function toIso(value: unknown): string {
  if (typeof value === 'string') return new Date(value).toISOString();
  if (typeof value === 'number') return new Date(value).toISOString();
  if (value instanceof Date) return value.toISOString();
  return new Date(0).toISOString();
}

function mapPrimaryAuditEvent(doc: any): AuditEvent {
  return {
    id: doc._id?.toString?.() ?? doc.id ?? `audit:${toIso(doc.timestamp)}`,
    timestamp: toIso(doc.timestamp),
    type: doc.type ?? 'agent_action',
    severity: doc.severity ?? 'info',
    agentId: doc.agentId ?? undefined,
    department: doc.department ?? undefined,
    title: doc.title ?? 'Audit event',
    detail: doc.detail ?? undefined,
    metadata: doc.metadata ?? undefined,
    actor: doc.actor ?? 'system',
  };
}

function mapOrgSettingsAuditEvent(doc: any): AuditEvent {
  const changes = doc.changes && typeof doc.changes === 'object' ? doc.changes : {};
  const keys = Object.keys(changes);
  return {
    id: doc._id?.toString?.() ?? `org-settings:${toIso(doc.timestamp)}`,
    timestamp: toIso(doc.timestamp),
    type: 'setting_change',
    severity: 'info',
    title: 'Organization settings updated',
    detail: keys.length > 0 ? `Changed: ${keys.join(', ')}` : undefined,
    metadata: changes,
    actor: 'human',
  };
}

function mapAuditLogEvent(doc: any): AuditEvent {
  const action = typeof doc.action === 'string' ? doc.action : 'audit_log';
  const detail =
    doc.newStatus
      ? `Status: ${doc.newStatus}`
      : doc.details
        ? JSON.stringify(doc.details)
        : undefined;

  return {
    id: doc._id?.toString?.() ?? `audit-log:${toIso(doc.timestamp)}`,
    timestamp: toIso(doc.timestamp),
    type: action.startsWith('fleet:') ? 'governance' : 'agent_action',
    severity: 'info',
    title: humanizeAction(action, doc.newStatus),
    detail,
    metadata: doc.details ?? undefined,
    actor: 'human',
  };
}

function humanizeAction(action: string, newStatus?: unknown): string {
  if (action === 'fleet:toggle' && typeof newStatus === 'string') {
    return newStatus === 'active' ? 'Fleet tasks resumed' : 'Fleet tasks paused';
  }
  if (action === 'fleet:mode:update' && newStatus === undefined) {
    return 'Fleet mode updated';
  }
  return action.replace(/[:_]/g, ' ');
}
