'use server';

import { getDb } from '@/lib/mongodb';
import { withAuth } from '@/lib/with-auth';

export type BudgetMode = 'enforcing' | 'tracking' | 'off';

export interface BudgetConfig {
  mode: BudgetMode;
  globalDailyLimitCents: number;
  globalMonthlyLimitCents: number;
  globalAction: 'alert' | 'pause' | 'hard_stop';
  globalAlertThresholdPercent: number;
  updatedAt?: string;
}

const DEFAULTS: BudgetConfig = {
  mode: 'enforcing',
  globalDailyLimitCents: 5000, // $50/day
  globalMonthlyLimitCents: 100000, // $1000/month
  globalAction: 'alert',
  globalAlertThresholdPercent: 80,
};

export async function getBudgetConfig(): Promise<BudgetConfig> {
  const db = await getDb();
  if (!db) return DEFAULTS;
  try {
    const doc = await db.collection('budget_config').findOne({ _id: 'global' as unknown as import('mongodb').ObjectId });
    if (!doc) return DEFAULTS;
    return {
      mode: (doc.mode as BudgetMode) ?? DEFAULTS.mode,
      globalDailyLimitCents: (doc.globalDailyLimitCents as number) ?? DEFAULTS.globalDailyLimitCents,
      globalMonthlyLimitCents: (doc.globalMonthlyLimitCents as number) ?? DEFAULTS.globalMonthlyLimitCents,
      globalAction: (doc.globalAction as BudgetConfig['globalAction']) ?? DEFAULTS.globalAction,
      globalAlertThresholdPercent: (doc.globalAlertThresholdPercent as number) ?? DEFAULTS.globalAlertThresholdPercent,
      updatedAt: doc.updatedAt as string | undefined,
    };
  } catch {
    return DEFAULTS;
  }
}

export const updateBudgetConfig = withAuth('root', async (
  _session,
  updates: Partial<BudgetConfig>,
): Promise<{ ok: boolean; error?: string }> => {
  const db = await getDb();
  if (!db) return { ok: false, error: 'Database unavailable' };

  // Validate mode
  if (updates.mode !== undefined && !['enforcing', 'tracking', 'off'].includes(updates.mode)) {
    return { ok: false, error: 'Invalid mode' };
  }

  // Validate numeric fields
  for (const field of ['globalDailyLimitCents', 'globalMonthlyLimitCents', 'globalAlertThresholdPercent'] as const) {
    const val = updates[field];
    if (val !== undefined) {
      if (typeof val !== 'number' || !isFinite(val) || val < 0) {
        return { ok: false, error: `${field} must be a non-negative finite number` };
      }
    }
  }

  // Validate globalAction
  if (updates.globalAction !== undefined && !['alert', 'pause', 'hard_stop'].includes(updates.globalAction)) {
    return { ok: false, error: 'Invalid globalAction' };
  }

  // Sanitize: round cents, clamp threshold
  const sanitized: Record<string, unknown> = { ...updates };
  if (typeof updates.globalDailyLimitCents === 'number') sanitized.globalDailyLimitCents = Math.round(updates.globalDailyLimitCents);
  if (typeof updates.globalMonthlyLimitCents === 'number') sanitized.globalMonthlyLimitCents = Math.round(updates.globalMonthlyLimitCents);
  if (typeof updates.globalAlertThresholdPercent === 'number') sanitized.globalAlertThresholdPercent = Math.max(0, Math.min(100, updates.globalAlertThresholdPercent));

  try {
    await db.collection('budget_config').updateOne(
      { _id: 'global' as unknown as import('mongodb').ObjectId },
      { $set: { ...sanitized, updatedAt: new Date().toISOString() } },
      { upsert: true }
    );
    return { ok: true };
  } catch {
    return { ok: false, error: 'Database write failed' };
  }
});
