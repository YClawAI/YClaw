import { getDb } from './mongodb';

export interface AgentSpend {
  agentId: string;
  today: number;
  week: number;
  month: number;
}

export async function getAgentSpend(agentNames: string[]): Promise<AgentSpend[]> {
  const db = await getDb();
  if (!db) return agentNames.map(a => ({ agentId: a, today: 0, week: 0, month: 0 }));

  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);
  const weekAgoStr = new Date(now.getTime() - 7 * 86400000).toISOString().slice(0, 10);
  const monthStartStr = `${now.toISOString().slice(0, 7)}-01`;

  try {
    // org_spend_daily uses `agent` field (not agentId) and `date` as YYYY-MM-DD string
    const docs = await db.collection('org_spend_daily')
      .find({ agent: { $in: agentNames }, date: { $gte: monthStartStr } })
      .toArray();

    return agentNames.map(agentId => {
      const agentDocs = docs.filter(d => d.agent === agentId);
      return {
        agentId,
        today: agentDocs
          .filter(d => (d.date as string) === todayStr)
          .reduce((s, d) => s + (Number(d.totalUsd) || 0), 0),
        week: agentDocs
          .filter(d => (d.date as string) >= weekAgoStr)
          .reduce((s, d) => s + (Number(d.totalUsd) || 0), 0),
        month: agentDocs.reduce((s, d) => s + (Number(d.totalUsd) || 0), 0),
      };
    });
  } catch {
    return agentNames.map(a => ({ agentId: a, today: 0, week: 0, month: 0 }));
  }
}
