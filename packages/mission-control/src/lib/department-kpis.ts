import { getDb } from './mongodb';

export interface DepartmentKPIs {
  runCount24h: number;
  runCount7d: number;
  errorCount24h: number;
  spendMTD: number;
}

export async function getDepartmentKPIs(agentNames: string[]): Promise<DepartmentKPIs> {
  const db = await getDb();
  if (!db) return { runCount24h: 0, runCount7d: 0, errorCount24h: 0, spendMTD: 0 };

  const now = new Date();
  const h24 = new Date(now.getTime() - 24 * 3600000);
  const d7 = new Date(now.getTime() - 7 * 86400000);
  // org_spend_daily.date is stored as YYYY-MM-DD string — use string comparison
  const monthStartStr = `${now.toISOString().slice(0, 7)}-01`;

  const [runCount24h, runCount7d, errorCount24h, spendMTD] = await Promise.all([
    db.collection('run_records').countDocuments({
      agentId: { $in: agentNames },
      createdAt: { $gte: h24 },
    }).catch(() => 0),

    db.collection('run_records').countDocuments({
      agentId: { $in: agentNames },
      createdAt: { $gte: d7 },
    }).catch(() => 0),

    db.collection('run_records').countDocuments({
      agentId: { $in: agentNames },
      status: 'error',
      createdAt: { $gte: h24 },
    }).catch(() => 0),

    // org_spend_daily uses `agent` field and string dates
    db.collection('org_spend_daily')
      .find({ agent: { $in: agentNames }, date: { $gte: monthStartStr } })
      .toArray()
      .then(docs => docs.reduce((sum, d) => sum + (Number(d.totalUsd) || 0), 0))
      .catch(() => 0),
  ]);

  return { runCount24h, runCount7d, errorCount24h, spendMTD: Math.round(spendMTD * 100) / 100 };
}
