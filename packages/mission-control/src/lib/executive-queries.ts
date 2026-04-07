import { getDb } from './mongodb';

export interface StandupSynthesis {
  summary: string;
  risks: string[];
  asks: string[];
  highlights: string[];
  generatedAt: string;
}

export async function getLatestStandupSynthesis(): Promise<StandupSynthesis | null> {
  const db = await getDb();
  if (!db) return null;

  try {
    const run = await db.collection('run_records').findOne(
      { agentId: 'strategist', taskId: 'standup_synthesis', status: 'success' },
      { sort: { createdAt: -1 } },
    );
    if (!run?.output) return null;

    // Output may be JSON string or structured text
    try {
      const parsed = JSON.parse(run.output as string);
      return {
        summary: parsed.summary || '',
        risks: parsed.risks || [],
        asks: parsed.asks || [],
        highlights: parsed.highlights || [],
        generatedAt: run.createdAt
          ? new Date(run.createdAt as string | number | Date).toISOString()
          : new Date().toISOString(),
      };
    } catch {
      // If not JSON, return raw output as summary
      return {
        summary: (run.output as string).slice(0, 2000),
        risks: [],
        asks: [],
        highlights: [],
        generatedAt: run.createdAt
          ? new Date(run.createdAt as string | number | Date).toISOString()
          : new Date().toISOString(),
      };
    }
  } catch {
    return null;
  }
}
