import { NextResponse } from 'next/server';
import { getBudgetConfig, updateBudgetConfig } from '@/lib/actions/budget-config';
import { requireSession, checkTier } from '@/lib/require-permission';

export const dynamic = 'force-dynamic';

function toResponse(config: Awaited<ReturnType<typeof getBudgetConfig>>) {
  return {
    mode: config.mode,
    dailyLimitUsd: config.globalDailyLimitCents / 100,
    monthlyLimitUsd: config.globalMonthlyLimitCents / 100,
    alertThresholdPercent: config.globalAlertThresholdPercent,
    action: config.globalAction,
    updatedAt: config.updatedAt,
  };
}

export async function GET() {
  const auth = await requireSession();
  if (auth.error) return auth.error;

  // root only — budget is org-wide
  const denied = checkTier(auth.session, 'root');
  if (denied) return denied;

  return NextResponse.json(toResponse(await getBudgetConfig()));
}

export async function PATCH(req: Request) {
  const auth = await requireSession();
  if (auth.error) return auth.error;

  // root only — budget modification
  const denied = checkTier(auth.session, 'root');
  if (denied) return denied;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const updates: Parameters<typeof updateBudgetConfig>[0] = {};

  if (body.mode !== undefined) {
    updates.mode = body.mode as Parameters<typeof updateBudgetConfig>[0]['mode'];
  }
  if (body.dailyLimitUsd !== undefined) {
    if (typeof body.dailyLimitUsd !== 'number' || !Number.isFinite(body.dailyLimitUsd) || body.dailyLimitUsd < 0) {
      return NextResponse.json({ error: 'dailyLimitUsd must be a non-negative number' }, { status: 400 });
    }
    updates.globalDailyLimitCents = Math.round(body.dailyLimitUsd * 100);
  }
  if (body.monthlyLimitUsd !== undefined) {
    if (typeof body.monthlyLimitUsd !== 'number' || !Number.isFinite(body.monthlyLimitUsd) || body.monthlyLimitUsd < 0) {
      return NextResponse.json({ error: 'monthlyLimitUsd must be a non-negative number' }, { status: 400 });
    }
    updates.globalMonthlyLimitCents = Math.round(body.monthlyLimitUsd * 100);
  }
  if (body.alertThresholdPercent !== undefined) {
    if (typeof body.alertThresholdPercent !== 'number' || !Number.isFinite(body.alertThresholdPercent) || body.alertThresholdPercent < 0 || body.alertThresholdPercent > 100) {
      return NextResponse.json({ error: 'alertThresholdPercent must be between 0 and 100' }, { status: 400 });
    }
    updates.globalAlertThresholdPercent = body.alertThresholdPercent;
  }
  if (body.action !== undefined) {
    if (body.action !== 'alert' && body.action !== 'pause' && body.action !== 'hard_stop') {
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    }
    updates.globalAction = body.action;
  }

  const result = await updateBudgetConfig(updates);
  if (!result.ok) {
    return NextResponse.json({ error: result.error ?? 'Failed to update budget config' }, { status: 400 });
  }

  return NextResponse.json(toResponse(await getBudgetConfig()));
}
