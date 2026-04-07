export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { getBudgetConfig } from '@/lib/actions/budget-config';

const SPEND_COLLECTION = 'org_spend_daily';

interface SpendDay {
  date: string;
  department: string;
  agent: string;
  totalUsd: number;
}

export async function GET(req: Request) {
  const db = await getDb();
  if (!db) {
    return NextResponse.json({
      month: '',
      totalUsd: 0,
      budgetCapUsd: 5000,
      burnPct: 0,
      burnRatePerDay: 0,
      projectedEndOfMonth: 0,
      byDepartment: {},
      byAgent: {},
      daily: [],
    });
  }

  const url = new URL(req.url);
  const monthParam = url.searchParams.get('month');

  // Validate YYYY-MM format
  const monthRegex = /^\d{4}-\d{2}$/;
  const month = monthParam && monthRegex.test(monthParam)
    ? monthParam
    : new Date().toISOString().slice(0, 7);

  // Date range for the month
  const startDate = `${month}-01`;
  const [year, mon] = month.split('-').map(Number);
  const nextMonth = mon === 12
    ? `${year! + 1}-01-01`
    : `${year}-${String(mon! + 1).padStart(2, '0')}-01`;

  // Query spend data using range (not regex)
  const docs = await db
    .collection(SPEND_COLLECTION)
    .find({ date: { $gte: startDate, $lt: nextMonth } })
    .toArray();

  const days: SpendDay[] = docs.map((d) => ({
    date: d.date as string,
    department: d.department as string,
    agent: d.agent as string,
    totalUsd: Number(d.totalUsd) || 0,
  }));

  // Aggregations
  const totalUsd = days.reduce((sum, d) => sum + d.totalUsd, 0);

  const byDepartment: Record<string, number> = {};
  const byAgent: Record<string, number> = {};
  const dailyMap: Record<string, number> = {};

  for (const d of days) {
    byDepartment[d.department] = (byDepartment[d.department] ?? 0) + d.totalUsd;
    byAgent[d.agent] = (byAgent[d.agent] ?? 0) + d.totalUsd;
    dailyMap[d.date] = (dailyMap[d.date] ?? 0) + d.totalUsd;
  }

  // Burn rate: average daily spend over days with data
  const uniqueDays = Object.keys(dailyMap).length;
  const burnRatePerDay = uniqueDays > 0 ? totalUsd / uniqueDays : 0;

  // Days remaining in month
  const now = new Date();
  const endOfMonth = new Date(year!, mon! - 1 + 1, 0); // last day
  const daysRemaining = Math.max(0, endOfMonth.getDate() - now.getDate());
  const projectedEndOfMonth = totalUsd + burnRatePerDay * daysRemaining;

  // Budget cap
  const budgetConfig = await getBudgetConfig();
  const budgetCapUsd = Math.max(0, budgetConfig.globalMonthlyLimitCents) / 100;
  const burnPct = budgetCapUsd > 0 ? (totalUsd / budgetCapUsd) * 100 : 0;

  return NextResponse.json({
    month,
    totalUsd: Math.round(totalUsd * 100) / 100,
    budgetCapUsd,
    burnPct: Math.round(burnPct * 10) / 10,
    burnRatePerDay: Math.round(burnRatePerDay * 100) / 100,
    projectedEndOfMonth: Math.round(projectedEndOfMonth * 100) / 100,
    byDepartment,
    byAgent,
    daily: Object.entries(dailyMap)
      .map(([date, usd]) => ({ date, usd: Math.round(usd * 100) / 100 }))
      .sort((a, b) => a.date.localeCompare(b.date)),
  });
}
