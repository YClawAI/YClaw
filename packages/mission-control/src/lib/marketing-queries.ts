import { getDb } from './mongodb';

export interface PublishedContent {
  id: string;
  title: string;
  type: string;
  publishedAt: string;
}

export async function getPublishedContent(limit = 20): Promise<PublishedContent[]> {
  const db = await getDb();
  if (!db) return [];

  try {
    const runs = await db.collection('run_records')
      .find({
        agentId: 'ember',
        status: 'success',
        output: { $exists: true, $ne: null },
      })
      .sort({ createdAt: -1 })
      .limit(limit)
      .toArray();

    return runs.map(r => {
      const output = (r.output as string) || '';
      let type = 'post';
      if (output.includes('telegram')) type = 'telegram';
      else if ((r.taskId as string)?.includes('thread')) type = 'thread';
      else if ((r.taskId as string)?.includes('content')) type = 'x';

      return {
        id: String(r._id),
        title: output.slice(0, 120) || (r.taskId as string) || 'Post',
        type,
        publishedAt: r.createdAt
          ? new Date(r.createdAt as string | number | Date).toISOString()
          : '',
      };
    });
  } catch {
    return [];
  }
}

export interface ForgeAssetRecord {
  id: string;
  name: string;
  status: string;
  model?: string;
  createdAt: string;
}

export async function getGeneratedAssets(limit = 20): Promise<ForgeAssetRecord[]> {
  const db = await getDb();
  if (!db) return [];

  try {
    const runs = await db.collection('run_records')
      .find({
        agentId: 'forge',
        status: { $in: ['success', 'error'] },
        output: { $exists: true, $ne: null },
      })
      .sort({ createdAt: -1 })
      .limit(limit)
      .toArray();

    return runs.map(r => ({
      id: String(r._id),
      name: (r.taskId as string) || 'Asset',
      status: r.status === 'success' ? 'ready' : 'failed',
      model: (r.taskId as string)?.includes('video') ? 'veo' : 'flux',
      createdAt: r.createdAt
        ? new Date(r.createdAt as string | number | Date).toISOString()
        : '',
    }));
  } catch {
    return [];
  }
}

export interface ScoutReport {
  id: string;
  topic: string;
  summary: string;
  sentiment?: string;
  createdAt: string;
}

export async function getScoutReports(limit = 20): Promise<ScoutReport[]> {
  const db = await getDb();
  if (!db) return [];

  try {
    const runs = await db.collection('run_records')
      .find({
        agentId: 'scout',
        status: 'success',
        output: { $exists: true, $ne: null },
      })
      .sort({ createdAt: -1 })
      .limit(limit)
      .toArray();

    return runs.map(r => {
      const output = (r.output as string) || '';
      const taskId = (r.taskId as string) || '';

      let topic = 'Intel Report';
      if (taskId.includes('prospect')) topic = 'Prospecting';
      else if (taskId.includes('monitor')) topic = 'X Monitoring';
      else if (taskId.includes('research')) topic = 'Research';

      return {
        id: String(r._id),
        topic,
        summary: output.slice(0, 300),
        createdAt: r.createdAt
          ? new Date(r.createdAt as string | number | Date).toISOString()
          : '',
      };
    });
  } catch {
    return [];
  }
}
