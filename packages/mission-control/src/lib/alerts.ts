import { getDb } from './mongodb';
import { getRedis } from './redis';
import type { Alert } from '@/components/alert-board';

/**
 * Derives system alerts from MongoDB + Redis data.
 * Returns Alert[] matching the AlertBoard component interface.
 */
export async function getActiveAlerts(): Promise<Alert[]> {
  const db = await getDb();
  if (!db) return [];

  const alerts: Alert[] = [];
  const now = Date.now();

  try {
    // 1. Error spike: >5 errors in last hour
    const recentErrors = await db.collection('run_records').countDocuments({
      status: { $in: ['error', 'failed'] },
      createdAt: { $gte: new Date(now - 3600000).toISOString() },
    });
    if (recentErrors > 5) {
      alerts.push({
        id: 'error-spike',
        severity: 'warning',
        title: `${recentErrors} agent errors in the last hour`,
        source: 'run_records',
        timestamp: new Date().toISOString(),
      });
    }

    // 2. Agent stuck: check Redis for agents with state='error'
    try {
      const redis = await getRedis();
      if (redis) {
        const agentNames = ['strategist', 'reviewer', 'architect', 'builder', 'deployer', 'designer', 'ember', 'forge', 'scout', 'sentinel', 'treasurer', 'guide', 'keeper'];
        for (const name of agentNames) {
          const state = await redis.hget(`agent:status:${name}`, 'state');
          if (state === 'error') {
            alerts.push({
              id: `agent-stuck-${name}`,
              severity: 'warning',
              title: `${name} in error state`,
              source: 'redis',
              timestamp: new Date().toISOString(),
            });
          }
        }
      }
    } catch {
      // Redis unavailable — skip agent-stuck checks
    }

    // 3. Stale treasury data: check each source independently (matches attention-engine pattern)
    try {
      const pipeline = [
        { $group: { _id: '$source', latestAt: { $max: '$createdAt' } } },
      ];
      const sourceDocs = await db.collection('treasury_snapshots').aggregate(pipeline).toArray();
      for (const doc of sourceDocs) {
        const source = (doc._id as string) || 'unknown';
        if (!doc.latestAt) continue;
        const age = now - new Date(doc.latestAt as string).getTime();
        if (age > 24 * 3600000) {
          const hoursAgo = Math.floor(age / 3600000);
          alerts.push({
            id: `stale-treasury-${source}`,
            severity: 'info',
            title: `Stale data: ${source}`,
            source: 'treasury_snapshots',
            timestamp: new Date().toISOString(),
            details: `Last ${source} snapshot is ${hoursAgo}h old`,
          });
        }
      }
    } catch {
      // Graceful
    }

    // 4. Stale activity: no run_records in last 6 hours (agents may be down)
    const latestRun = await db.collection('run_records').findOne(
      {},
      { sort: { createdAt: -1 }, projection: { createdAt: 1 } },
    );
    if (latestRun?.createdAt) {
      const hoursSinceLastRun = (now - new Date(latestRun.createdAt as string).getTime()) / 3600000;
      if (hoursSinceLastRun > 6) {
        alerts.push({
          id: 'stale-activity',
          severity: 'info',
          title: `No agent activity for ${Math.floor(hoursSinceLastRun)} hours`,
          source: 'run_records',
          timestamp: new Date().toISOString(),
        });
      }
    }

    // 5. Budget alerts: any agent over their alert threshold (default 80%)
    const todayStr = new Date().toISOString().slice(0, 10);
    const budgets = await db.collection('agent_budgets').find({}).toArray();
    for (const b of budgets) {
      // Handle both cents (dailyLimitCents) and legacy dollars (dailyLimit)
      let limitCents: number;
      if (b.dailyLimitCents != null) {
        limitCents = Number(b.dailyLimitCents);
      } else if (b.dailyLimit != null) {
        // Legacy: dailyLimit is in dollars, convert to cents
        limitCents = Math.round(Number(b.dailyLimit) * 100);
      } else {
        continue;
      }
      if (!limitCents || limitCents <= 0) continue;

      const agentId = (b.agentId ?? b.agentName ?? b.agent) as string | undefined;
      if (!agentId) continue;

      // Per-agent alert threshold — check both current and legacy field names (default 80%)
      const threshold = (b.alertThresholdPercent as number | undefined)
        ?? (b.alertThreshold as number | undefined)
        ?? 80;

      const dailySpend = await db.collection('org_spend_daily').findOne({
        $or: [{ agent: agentId }, { agentName: agentId }, { agentId: agentId }],
        date: todayStr,
      });
      if (!dailySpend) continue;

      // Support both cents and dollars in the spend collection
      const spendCents = dailySpend.totalCents != null
        ? Number(dailySpend.totalCents)
        : (Number(dailySpend.totalUsd) || 0) * 100;
      const pct = (spendCents / limitCents) * 100;

      if (pct > threshold) {
        alerts.push({
          id: `budget-${agentId}`,
          severity: pct >= 100 ? 'critical' : 'warning',
          title: `${agentId} at ${Math.round(pct)}% of daily budget`,
          source: 'budget',
          timestamp: new Date().toISOString(),
          details: `$${(spendCents / 100).toFixed(2)} / $${(limitCents / 100).toFixed(2)}`,
        });
      }
    }
  } catch {
    // Graceful degradation — return whatever alerts were collected so far
  }

  // Sort: critical first, then warning, then info
  const order: Record<string, number> = { critical: 3, warning: 2, info: 1 };
  return alerts.sort((a, b) => (order[b.severity] ?? 0) - (order[a.severity] ?? 0));
}
