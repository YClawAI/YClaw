export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { requireSession, checkTier } from '@/lib/require-permission';

const AUDIT_COLLECTION = 'org_settings_audit';

export async function GET(req: Request) {
  const auth = await requireSession();
  if (auth.error) return auth.error;
  const denied = checkTier(auth.session, 'department_head');
  if (denied) return denied;

  const db = await getDb();
  if (!db) {
    return NextResponse.json({ entries: [], total: 0 });
  }

  const url = new URL(req.url);
  const page = Math.max(1, Number(url.searchParams.get('page')) || 1);
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit')) || 20));
  const skip = (page - 1) * limit;

  const [entries, total] = await Promise.all([
    db
      .collection(AUDIT_COLLECTION)
      .find({})
      .sort({ timestamp: -1 })
      .skip(skip)
      .limit(limit)
      .toArray(),
    db.collection(AUDIT_COLLECTION).countDocuments(),
  ]);

  return NextResponse.json({
    entries: entries.map((e) => ({
      timestamp: e.timestamp,
      changes: e.changes,
      source: e.source,
    })),
    total,
    page,
    limit,
  });
}

export async function DELETE(req: Request) {
  const auth = await requireSession();
  if (auth.error) return auth.error;
  // Deleting audit data requires root
  const denied = checkTier(auth.session, 'root');
  if (denied) return denied;

  const db = await getDb();
  if (!db) {
    return NextResponse.json({ error: 'Database unavailable' }, { status: 503 });
  }

  const url = new URL(req.url);
  const retentionDays = url.searchParams.get('retentionDays');

  // If retention is set to "forever", honour it — no purge
  if (!retentionDays || retentionDays === 'forever') {
    return NextResponse.json({
      deleted: 0,
      message: 'Retention is set to forever — no logs purged',
    });
  }

  const days = parseInt(retentionDays, 10);
  if (isNaN(days) || days < 1) {
    return NextResponse.json({ error: 'Invalid retentionDays parameter' }, { status: 400 });
  }

  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const result = await db.collection(AUDIT_COLLECTION).deleteMany({
    timestamp: { $lt: cutoff },
  });

  return NextResponse.json({ deleted: result.deletedCount });
}
