import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { getRedis } from '@/lib/redis';
import { getDb } from '@/lib/mongodb';
import { randomUUID } from 'crypto';
import { requireSession, checkTier } from '@/lib/require-permission';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DEFAULT_FLAGS: Record<string, boolean> = {
  FF_CONTEXT_COMPRESSION: true,
  FF_PROMPT_CACHING: true,
  FF_MEMORY_SCANNER: true,
  FF_DEPLOY_GOVERNANCE: false,
};

function parseFlags(json: string | null): Record<string, boolean> {
  if (!json) return DEFAULT_FLAGS;
  try {
    const parsed = JSON.parse(json);
    if (typeof parsed === 'object' && parsed !== null) return parsed;
  } catch { /* fall through */ }
  return DEFAULT_FLAGS;
}

export async function GET() {
  const auth = await requireSession();
  if (auth.error) return auth.error;
  const denied = checkTier(auth.session, 'department_head');
  if (denied) return denied;

  const redis = getRedis();
  if (!redis) {
    return NextResponse.json({
      mode: 'active',
      defaultModel: 'claude-opus-4-6',
      fallbackModel: 'claude-sonnet-4-6',
      deployMode: 'auto',
      flags: DEFAULT_FLAGS,
    });
  }

  try {
    const [mode, status, defaultModel, fallbackModel, deployMode, flagsJson] = await Promise.all([
      redis.get('fleet:mode'),
      redis.get('fleet:status'),
      redis.get('fleet:default-model'),
      redis.get('fleet:fallback-model'),
      redis.get('fleet:deploy-mode'),
      redis.get('fleet:flags'),
    ]);

    const resolvedMode =
      mode === 'active' || mode === 'paused'
        ? mode
        : status === 'active' || status === 'paused'
          ? status
          : 'active';

    return NextResponse.json({
      mode: resolvedMode,
      defaultModel: defaultModel || 'claude-opus-4-6',
      fallbackModel: fallbackModel || 'claude-sonnet-4-6',
      deployMode: deployMode || 'auto',
      flags: parseFlags(flagsJson),
    });
  } catch {
    return NextResponse.json({
      mode: 'active',
      defaultModel: 'claude-opus-4-6',
      fallbackModel: 'claude-sonnet-4-6',
      deployMode: 'auto',
      flags: DEFAULT_FLAGS,
      degraded: true,
    });
  }
}

export async function PUT(req: NextRequest) {
  const auth = await requireSession();
  if (auth.error) return auth.error;
  const denied = checkTier(auth.session, 'root');
  if (denied) return denied;

  const redis = getRedis();
  if (!redis) {
    return NextResponse.json({ error: 'Redis unavailable' }, { status: 503 });
  }

  try {
    const updates = await req.json();
    const pipeline = redis.pipeline();
    let publishedFleetStatus: 'active' | 'paused' | null = null;

    if (updates.mode === 'active' || updates.mode === 'paused') {
      const mode = updates.mode;
      pipeline.set('fleet:mode', mode);
      publishedFleetStatus = mode;
      pipeline.set('fleet:status', mode);
    }
    if (updates.defaultModel) pipeline.set('fleet:default-model', updates.defaultModel);
    if (updates.fallbackModel) pipeline.set('fleet:fallback-model', updates.fallbackModel);
    if (updates.deployMode) pipeline.set('fleet:deploy-mode', updates.deployMode);
    if (updates.flags) pipeline.set('fleet:flags', JSON.stringify(updates.flags));

    const results = await pipeline.exec();

    // Check for per-command errors
    const failed = results?.some(([err]) => err != null);
    if (failed) {
      return NextResponse.json({ error: 'Partial update failure' }, { status: 500 });
    }

    if (publishedFleetStatus) {
      try {
        await redis.publish(
          'fleet:status',
          JSON.stringify({ status: publishedFleetStatus, at: new Date().toISOString() }),
        );
      } catch { /* best-effort pub/sub */ }
    }

    if (updates.mode) {
      const db = await getDb();
      if (db) {
        try {
          await db.collection('audit_log').insertOne({
            action: 'fleet:mode:update',
            timestamp: new Date().toISOString(),
            source: 'mission-control',
            details: updates,
          });
        } catch {
          // best-effort audit
        }
      }

      try {
        await redis.publish('audit:events', JSON.stringify({
          id: randomUUID(),
          timestamp: new Date().toISOString(),
          type: 'governance',
          severity: 'info',
          title: `Fleet mode set to ${updates.mode}`,
          detail: `Mission Control updated fleet mode to ${updates.mode}.`,
          actor: 'human',
          metadata: updates,
        }));
      } catch { /* best-effort pub/sub */ }
    }

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: 'Failed to update' }, { status: 500 });
  }
}
