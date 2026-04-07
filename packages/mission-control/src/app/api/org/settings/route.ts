export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { redisPublish, redisSet } from '@/lib/redis';
import { randomUUID } from 'crypto';
import { requireSession, checkTier } from '@/lib/require-permission';

const COLLECTION = 'org_settings';
const AUDIT_COLLECTION = 'org_settings_audit';
const SETTINGS_ID = 'global';

const DEFAULTS: Record<string, unknown> = {
  defaultModel: 'claude-sonnet-4-6',
  fallbackModel: 'claude-haiku-4-5-20251001',
  deployMode: 'review',
  fleetMode: 'active',
};

/** Whitelist of editable keys + type validators */
const ALLOWED_KEYS: Record<string, (v: unknown) => boolean> = {
  // Core / fleet
  defaultModel: (v) => typeof v === 'string' && v.length > 0,
  fallbackModel: (v) => typeof v === 'string' && v.length > 0,
  deployMode: (v) =>
    typeof v === 'string' && ['auto', 'review', 'lockdown'].includes(v),
  fleetMode: (v) =>
    typeof v === 'string' && ['active', 'paused'].includes(v),
  orgLogo: (v) => v === null || (typeof v === 'string' && v.startsWith('data:image/')),
  skills: (v) => typeof v === 'object' && v !== null && !Array.isArray(v),

  // Organization metadata
  orgName: (v) => typeof v === 'string' && v.length > 0 && v.length <= 100,
  timezone: (v) => typeof v === 'string' && v.length > 0 && v.length <= 100,
  language: (v) => typeof v === 'string' && v.length > 0 && v.length <= 50,

  // Data access & privacy
  piiMode: (v) =>
    typeof v === 'string' && ['avoid', 'redact', 'allowed'].includes(v),
  redactWallets: (v) => typeof v === 'boolean',
  redactEmails: (v) => typeof v === 'boolean',
  logPrompts: (v) => typeof v === 'boolean',
  logRetention: (v) =>
    typeof v === 'string' && ['7', '30', '90', '365'].includes(v),
  logSamplingRate: (v) =>
    (typeof v === 'string' || typeof v === 'number') &&
    Number(v) >= 1 && Number(v) <= 100,
  readExternalUrls: (v) => typeof v === 'boolean',
  writeExternalServices: (v) => typeof v === 'boolean',
  fileSystemAccess: (v) => typeof v === 'boolean',

  // Notifications & alerts
  defaultAlertChannel: (v) => typeof v === 'string' && v.length <= 200,
  secondaryAlertChannel: (v) => typeof v === 'string' && v.length <= 200,
  criticalEmail: (v) => typeof v === 'string' && v.length <= 200,
  alertAgentFailure: (v) => typeof v === 'boolean',
  alertConnectionLost: (v) => typeof v === 'boolean',
  alertSecurityEvent: (v) => typeof v === 'boolean',
  alertFleetHealth: (v) => typeof v === 'boolean',
  alertDeployComplete: (v) => typeof v === 'boolean',
  alertDailyDigest: (v) => typeof v === 'boolean',
  quietHours: (v) => typeof v === 'boolean',
  quietStart: (v) => typeof v === 'string' && /^\d{2}:\d{2}$/.test(v),
  quietEnd: (v) => typeof v === 'string' && /^\d{2}:\d{2}$/.test(v),
  quietBehavior: (v) =>
    typeof v === 'string' &&
    ['suppress-all', 'critical-only', 'no-change'].includes(v),

  // Security & audit
  auditLogging: (v) => typeof v === 'boolean',
  auditRetention: (v) =>
    typeof v === 'string' && ['30', '90', '365', 'forever'].includes(v),
};

export async function GET() {
  const auth = await requireSession();
  if (auth.error) return auth.error;

  // department_head+ can view settings
  const denied = checkTier(auth.session, 'department_head');
  if (denied) return denied;

  const db = await getDb();
  if (!db) {
    return NextResponse.json({ ...DEFAULTS }, { status: 200 });
  }

  const doc = await db.collection(COLLECTION).findOne({ _id: SETTINGS_ID as any });
  const settings = { ...DEFAULTS, ...(doc ?? {}) };
  delete (settings as any)._id;
  if (settings.fleetMode !== 'active' && settings.fleetMode !== 'paused') {
    settings.fleetMode = 'paused';
  }

  return NextResponse.json(settings);
}

export async function PATCH(req: Request) {
  const auth = await requireSession();
  if (auth.error) return auth.error;

  // root only — org settings modification
  const denied = checkTier(auth.session, 'root');
  if (denied) return denied;

  const db = await getDb();
  if (!db) {
    return NextResponse.json(
      { error: 'Database unavailable' },
      { status: 503 },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  // Validate each key
  const updates: Record<string, unknown> = {};
  const rejected: string[] = [];

  for (const [key, value] of Object.entries(body)) {
    const validator = ALLOWED_KEYS[key];
    if (!validator) {
      rejected.push(key);
      continue;
    }
    if (!validator(value)) {
      return NextResponse.json(
        { error: `Invalid value for ${key}` },
        { status: 400 },
      );
    }
    updates[key] = value;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json(
      { error: 'No valid keys to update', rejected },
      { status: 400 },
    );
  }

  // Apply update
  await db.collection(COLLECTION).updateOne(
    { _id: SETTINGS_ID as any },
    { $set: { ...updates, updatedAt: new Date().toISOString() } },
    { upsert: true },
  );

  if (typeof updates.fleetMode === 'string') {
    await redisSet('fleet:mode', updates.fleetMode);
    const taskStatus = updates.fleetMode === 'active' ? 'active' : 'paused';
    await redisSet('fleet:status', taskStatus);
    await redisPublish(
      'fleet:status',
      JSON.stringify({ status: taskStatus, at: new Date().toISOString() }),
    );
  }

  // Return merged result
  const doc = await db.collection(COLLECTION).findOne({ _id: SETTINGS_ID as any });
  const result = { ...DEFAULTS, ...(doc ?? {}) };
  delete (result as any)._id;

  // Gate audit writes on the effective auditLogging setting.
  // Defaults to true (audit logging enabled) unless explicitly set to false.
  const auditLoggingEnabled = (result as Record<string, unknown>).auditLogging !== false;

  if (auditLoggingEnabled) {
    // Write audit entry
    await db.collection(AUDIT_COLLECTION).insertOne({
      timestamp: new Date().toISOString(),
      changes: updates,
      source: 'mission-control',
    });

    await redisPublish('audit:events', JSON.stringify({
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      type: 'setting_change',
      severity: 'info',
      title: 'Organization settings updated',
      detail: Object.keys(updates).join(', '),
      actor: 'human',
      metadata: updates,
    }));
  }

  return NextResponse.json(result);
}
