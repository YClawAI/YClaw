import { getDb } from './mongodb';

export interface ObjectiveSummary {
  id: string;
  title: string;
  status: string;
  priority: string;
  department: string;
  ownerAgentId: string;
  kpis: Array<{ metric: string; current: number; target: number; unit: string }>;
  costSpentCents: number;
  costBudgetCents: number;
  childTaskCount: number;
  createdAt: string;
  updatedAt: string;
}

export async function getActiveObjectiveCount(): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  try {
    return await db.collection('objectives').countDocuments({ status: { $in: ['active', 'in_progress'] } });
  } catch {
    return 0;
  }
}

export async function getObjectives(filters?: {
  status?: string;
  department?: string;
  limit?: number;
}): Promise<ObjectiveSummary[]> {
  const db = await getDb();
  if (!db) return [];

  try {
    const query: Record<string, unknown> = {};
    if (filters?.status) query.status = filters.status;
    if (filters?.department) query.department = filters.department;

    const docs = await db.collection('objectives')
      .find(query)
      .sort({ priority: 1, updatedAt: -1 })
      .limit(filters?.limit || 50)
      .toArray();

    return docs.map(d => ({
      id: d._id ? String(d._id) : (d.id as string || ''),
      title: (d.title ?? d.name ?? 'Untitled') as string,
      status: (d.status as string) || 'unknown',
      priority: (d.priority as string) || 'P2',
      department: (d.department as string) || '',
      ownerAgentId: (d.ownerAgentId as string) || '',
      kpis: (d.kpis || []) as ObjectiveSummary['kpis'],
      costSpentCents: (d.costSpentCents as number) || 0,
      costBudgetCents: (d.costBudgetCents as number) || 0,
      childTaskCount: ((d.childTaskIds as string[]) || []).length,
      createdAt: d.createdAt
        ? new Date(d.createdAt as string | number | Date).toISOString()
        : '',
      updatedAt: d.updatedAt
        ? new Date(d.updatedAt as string | number | Date).toISOString()
        : '',
    }));
  } catch {
    return [];
  }
}
