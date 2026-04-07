'use server';

import { getDb } from '@/lib/mongodb';
import { withAuth } from '@/lib/with-auth';

export interface AgentBudget {
  agentId: string;
  dailyLimitCents: number;
  monthlyLimitCents: number;
  action: 'alert' | 'pause' | 'hard_stop';
  alertThresholdPercent: number; // 0-100
  updatedAt?: string;
}

const VALID_ACTIONS = new Set(['alert', 'pause', 'hard_stop']);

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function validateBudgetFields(
  budget: Partial<Omit<AgentBudget, 'agentId'>>
): { valid: Partial<Omit<AgentBudget, 'agentId'>>; error?: string } {
  const cleaned: Partial<Omit<AgentBudget, 'agentId'>> = {};

  if (budget.dailyLimitCents !== undefined) {
    if (typeof budget.dailyLimitCents !== 'number' || !isFinite(budget.dailyLimitCents)) {
      return { valid: {}, error: 'dailyLimitCents must be a finite number' };
    }
    cleaned.dailyLimitCents = clamp(Math.round(budget.dailyLimitCents), 0, 10_000_000);
  }

  if (budget.monthlyLimitCents !== undefined) {
    if (typeof budget.monthlyLimitCents !== 'number' || !isFinite(budget.monthlyLimitCents)) {
      return { valid: {}, error: 'monthlyLimitCents must be a finite number' };
    }
    cleaned.monthlyLimitCents = clamp(Math.round(budget.monthlyLimitCents), 0, 1_000_000_000);
  }

  if (budget.action !== undefined) {
    if (!VALID_ACTIONS.has(budget.action)) {
      return { valid: {}, error: `action must be one of: ${[...VALID_ACTIONS].join(', ')}` };
    }
    cleaned.action = budget.action;
  }

  if (budget.alertThresholdPercent !== undefined) {
    if (typeof budget.alertThresholdPercent !== 'number' || !isFinite(budget.alertThresholdPercent)) {
      return { valid: {}, error: 'alertThresholdPercent must be a finite number' };
    }
    cleaned.alertThresholdPercent = clamp(budget.alertThresholdPercent, 0, 100);
  }

  return { valid: cleaned };
}

/**
 * Lazy migration: convert old dollar-based documents to cents.
 * If a document has `dailyLimit` (dollars) but NOT `dailyLimitCents`, migrate it.
 */
async function maybeMigrateDoc(
  col: { updateOne: (filter: Record<string, unknown>, update: Record<string, unknown>) => Promise<unknown> },
  doc: Record<string, unknown>,
): Promise<void> {
  if (doc.dailyLimit !== undefined && doc.dailyLimitCents === undefined) {
    const dailyCents = Math.round((doc.dailyLimit as number) * 100);
    const monthlyCents = typeof doc.monthlyLimit === 'number' && isFinite(doc.monthlyLimit)
      ? Math.round((doc.monthlyLimit as number) * 100)
      : dailyCents * 30;
    const migrated = {
      dailyLimitCents: dailyCents,
      monthlyLimitCents: monthlyCents,
      alertThresholdPercent: (doc.alertThreshold as number) ?? (doc.alertThresholdPercent as number) ?? 80,
    };
    await col.updateOne(
      { agentId: doc.agentId },
      { $set: migrated, $unset: { dailyLimit: '', monthlyLimit: '', alertThreshold: '' } as Record<string, unknown> },
    );
    Object.assign(doc, migrated);
  }
}

export async function getBudgets(): Promise<AgentBudget[]> {
  const db = await getDb();
  if (!db) return [];
  try {
    const col = db.collection('agent_budgets');
    const raw = await col.find({}).toArray();
    for (const doc of raw) {
      await maybeMigrateDoc(col as unknown as Parameters<typeof maybeMigrateDoc>[0], doc as unknown as Record<string, unknown>);
    }
    return raw.map((r) => ({
      agentId: r.agentId as string,
      dailyLimitCents: (r.dailyLimitCents as number) ?? 1000,
      monthlyLimitCents: (r.monthlyLimitCents as number) ?? 20000,
      action: (r.action as AgentBudget['action']) ?? 'alert',
      alertThresholdPercent: (r.alertThresholdPercent as number) ?? 80,
      updatedAt: r.updatedAt as string | undefined,
    }));
  } catch {
    return [];
  }
}

export const updateBudget = withAuth('root', async (
  _session,
  agentId: string,
  budget: Partial<Omit<AgentBudget, 'agentId'>>,
): Promise<{ ok: boolean; error?: string }> => {
  const { valid, error } = validateBudgetFields(budget);
  if (error) {
    return { ok: false, error };
  }

  if (Object.keys(valid).length === 0) {
    return { ok: false, error: 'No valid fields to update' };
  }

  const db = await getDb();
  if (!db) return { ok: false, error: 'Database unavailable' };

  try {
    await db.collection('agent_budgets').updateOne(
      { agentId },
      { $set: { ...valid, updatedAt: new Date().toISOString() } },
      { upsert: true }
    );
    return { ok: true };
  } catch {
    return { ok: false, error: 'Database write failed' };
  }
});

export const setAllBudgets = withAuth('root', async (
  _session,
  dailyLimitCents: number,
  monthlyLimitCents: number,
): Promise<{ ok: boolean; error?: string }> => {
  if (typeof dailyLimitCents !== 'number' || !isFinite(dailyLimitCents) || dailyLimitCents < 0) {
    return { ok: false, error: 'dailyLimitCents must be a non-negative number' };
  }
  if (typeof monthlyLimitCents !== 'number' || !isFinite(monthlyLimitCents) || monthlyLimitCents < 0) {
    return { ok: false, error: 'monthlyLimitCents must be a non-negative number' };
  }

  const clampedDaily = clamp(Math.round(dailyLimitCents), 0, 10_000_000);
  const clampedMonthly = clamp(Math.round(monthlyLimitCents), 0, 1_000_000_000);

  const db = await getDb();
  if (!db) return { ok: false, error: 'Database unavailable' };

  try {
    const { AGENTS } = await import('@/lib/agents');
    const ops = AGENTS.map((a) => ({
      updateOne: {
        filter: { agentId: a.name },
        update: {
          $set: {
            dailyLimitCents: clampedDaily,
            monthlyLimitCents: clampedMonthly,
            updatedAt: new Date().toISOString(),
          },
          $setOnInsert: {
            agentId: a.name,
            action: 'alert' as const,
            alertThresholdPercent: 80,
          },
        },
        upsert: true,
      },
    }));
    await db.collection('agent_budgets').bulkWrite(ops);
    return { ok: true };
  } catch {
    return { ok: false, error: 'Database write failed' };
  }
});
