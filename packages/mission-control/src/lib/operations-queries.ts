import { getDb } from './mongodb';
import { getRedis, redisPing, getRedisConnectionState } from './redis';
import { getOctokit } from './github';

export interface AuditEntry {
  id: string;
  action: string;
  timestamp: string;
  source: string;
  details?: Record<string, unknown>;
}

export async function getAuditLog(limit = 50): Promise<AuditEntry[]> {
  const db = await getDb();
  if (!db) return [];

  try {
    const docs = await db.collection('audit_log')
      .find({})
      .sort({ timestamp: -1 })
      .limit(limit)
      .toArray();

    return docs.map(d => ({
      id: String(d._id),
      action: (d.action as string) || '',
      timestamp: d.timestamp
        ? new Date(d.timestamp as string | number | Date).toISOString()
        : '',
      source: (d.source as string) || 'system',
      details: d.details as Record<string, unknown> | undefined,
    }));
  } catch {
    return [];
  }
}

export interface AuditSummaryData {
  date: string;
  grade?: string;
  gradeParseError?: boolean;
  rawOutputSnippet?: string;
  findingsCount?: number;
  summary?: string;
}

export async function getSentinelAudits(): Promise<{
  latest: AuditSummaryData | null;
  history: AuditSummaryData[];
}> {
  const db = await getDb();
  if (!db) return { latest: null, history: [] };

  try {
    const runs = await db.collection('run_records')
      .find({
        agentId: 'sentinel',
        taskId: { $in: ['code_quality_audit', 'code_audit'] },
        status: { $in: ['success', 'completed'] },
      })
      .sort({ createdAt: -1 })
      .limit(10)
      .toArray();

    const history: AuditSummaryData[] = runs.map(r => {
      const output = (r.output as string) || '';
      let grade: string | undefined;
      let gradeParseError = false;
      let findingsCount: number | undefined;

      // Try to extract grade from output
      const gradeMatch = output.match(/grade[:\s]*([A-F][+-]?)/i);
      if (gradeMatch) {
        grade = gradeMatch[1]!.toUpperCase();
      } else if (output.length > 0) {
        // Output exists but grade regex didn't match — flag as parse error
        gradeParseError = true;
        console.warn(`[sentinel-audit] Grade parse failed for run ${r.createdAt}: no grade pattern in output (first 100 chars: ${output.slice(0, 100)})`);
      }

      // Try to extract findings count
      const findingsMatch = output.match(/(\d+)\s*finding/i);
      if (findingsMatch) findingsCount = parseInt(findingsMatch[1]!, 10);

      return {
        date: r.createdAt
          ? new Date(r.createdAt as string | number | Date).toISOString()
          : '',
        grade,
        gradeParseError,
        rawOutputSnippet: gradeParseError ? output.slice(0, 200) : undefined,
        findingsCount,
        summary: output.slice(0, 500),
      };
    });

    return {
      latest: history[0] || null,
      history,
    };
  } catch {
    return { latest: null, history: [] };
  }
}

export interface ServiceHealthCheck {
  name: string;
  status: string;
  lastCheck: string;
  latency?: number;
  errorRate?: number;
}

export async function getHealthChecks(): Promise<ServiceHealthCheck[]> {
  const now = new Date().toISOString();
  const checks: ServiceHealthCheck[] = [];

  // MongoDB check
  const mongoStart = Date.now();
  const db = await getDb();
  const mongoLatency = Date.now() - mongoStart;
  checks.push({
    name: 'MongoDB Atlas',
    status: db ? 'healthy' : 'down',
    lastCheck: now,
    latency: mongoLatency,
  });

  // Redis check
  const redisStart = Date.now();
  const redis = await getRedis();
  const redisOk = redis ? await redisPing() : false;
  const redisLatency = Date.now() - redisStart;
  const redisState = getRedisConnectionState();
  checks.push({
    name: 'Redis',
    status: redisOk ? 'healthy' : redisState === 'reconnecting' ? 'reconnecting' : redis ? 'degraded' : 'down',
    lastCheck: now,
    latency: redisLatency,
  });

  // GitHub API check — make a real API call, not just token presence
  const ghStart = Date.now();
  const octokit = getOctokit();
  if (octokit) {
    try {
      await octokit.rest.rateLimit.get();
      checks.push({
        name: 'GitHub API',
        status: 'healthy',
        lastCheck: now,
        latency: Date.now() - ghStart,
      });
    } catch {
      checks.push({
        name: 'GitHub API',
        status: 'down',
        lastCheck: now,
        latency: Date.now() - ghStart,
      });
    }
  } else {
    checks.push({
      name: 'GitHub API',
      status: 'down',
      lastCheck: now,
      latency: Date.now() - ghStart,
    });
  }

  return checks;
}
