import { getDb } from './mongodb';
import { sanitize } from './log-sanitizer';

export type EventSource = 'run_record' | 'event_log';

export interface UnifiedEvent {
  id: string;
  source: EventSource;
  agentId: string;
  type: string;
  status?: string;
  createdAt: string;
  taskId?: string;
  executionId?: string;
  cost?: number;
  payload?: Record<string, unknown>;
}

export interface EventLogFilters {
  agent?: string;
  type?: string;
  status?: string;
  from?: string;
  to?: string;
}

export interface EventLogPage {
  events: UnifiedEvent[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

function sanitizePayload(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (key === '_id') continue;
    if (typeof value === 'string') {
      result[key] = sanitize(value);
    } else if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      result[key] = sanitizePayload(value as Record<string, unknown>);
    } else {
      result[key] = value;
    }
  }
  return result;
}

export async function queryEventLog(
  filters: EventLogFilters = {},
  page = 1,
  pageSize = 50,
): Promise<EventLogPage> {
  const db = await getDb();
  if (!db) return { events: [], total: 0, page, pageSize, totalPages: 0 };

  const skip = (page - 1) * pageSize;

  // Build time range filter
  const timeFilter: Record<string, unknown> = {};
  if (filters.from) timeFilter.$gte = filters.from;
  if (filters.to) timeFilter.$lte = filters.to;

  // ── Query run_records ──────────────────────────────────────────────
  const runQuery: Record<string, unknown> = {};
  if (filters.agent) runQuery.agentId = filters.agent;
  if (filters.status) runQuery.status = filters.status;
  if (Object.keys(timeFilter).length > 0) runQuery.createdAt = timeFilter;

  // ── Query event_log ────────────────────────────────────────────────
  const evtQuery: Record<string, unknown> = {};
  if (filters.agent) evtQuery.agentId = filters.agent;
  if (filters.type) evtQuery.type = filters.type;
  if (filters.status) evtQuery.status = filters.status;
  if (Object.keys(timeFilter).length > 0) evtQuery.createdAt = timeFilter;

  try {
    // Fetch from both collections in parallel
    const [runs, evts] = await Promise.all([
      // Only skip event_log-type filter on run_records (run_records has no 'type' field)
      filters.type && filters.type !== 'run'
        ? Promise.resolve([])
        : db.collection('run_records').find(runQuery).sort({ createdAt: -1 }).limit(500).toArray(),

      // event_log is optional — graceful if collection doesn't exist
      db.collection('event_log').find(evtQuery).sort({ createdAt: -1 }).limit(500).toArray().catch(() => []),
    ]);

    // Normalise run_records
    const runEvents: UnifiedEvent[] = runs.map((r) => {
      const { _id, agentId, status, createdAt, taskId, executionId, cost, ...rest } = r as Record<string, unknown>;
      return {
        id: String(_id),
        source: 'run_record' as EventSource,
        agentId: (agentId as string) || 'unknown',
        type: 'run',
        status: (status as string) || undefined,
        createdAt: (createdAt as string) || new Date(0).toISOString(),
        taskId: (taskId as string) || undefined,
        executionId: (executionId as string) || undefined,
        cost: typeof cost === 'object' && cost !== null
          ? ((cost as Record<string, unknown>).totalUsd as number | undefined)
          : (cost as number | undefined),
        payload: sanitizePayload(rest),
      };
    });

    // Normalise event_log docs
    const evtEvents: UnifiedEvent[] = evts.map((e) => {
      const { _id, agentId, type, status, createdAt, taskId, executionId, ...rest } = e as Record<string, unknown>;
      return {
        id: String(_id),
        source: 'event_log' as EventSource,
        agentId: (agentId as string) || 'unknown',
        type: (type as string) || 'event',
        status: (status as string) || undefined,
        createdAt: (createdAt as string) || new Date(0).toISOString(),
        taskId: (taskId as string) || undefined,
        executionId: (executionId as string) || undefined,
        payload: sanitizePayload(rest),
      };
    });

    // Merge and sort by createdAt descending
    const merged = [...runEvents, ...evtEvents].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );

    const total = merged.length;
    const slice = merged.slice(skip, skip + pageSize);

    return {
      events: slice,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  } catch {
    return { events: [], total: 0, page, pageSize, totalPages: 0 };
  }
}

/** Fetch distinct agent IDs from both collections (for filter dropdowns). */
export async function getEventLogAgents(): Promise<string[]> {
  const db = await getDb();
  if (!db) return [];
  try {
    const [runAgents, evtAgents] = await Promise.all([
      db.collection('run_records').distinct('agentId'),
      db.collection('event_log').distinct('agentId').catch(() => [] as string[]),
    ]);
    return [...new Set([...runAgents, ...evtAgents] as string[])].sort();
  } catch {
    return [];
  }
}

/** Fetch distinct event types from event_log (for filter dropdowns). */
export async function getEventLogTypes(): Promise<string[]> {
  const db = await getDb();
  if (!db) return ['run'];
  try {
    const evtTypes = await db.collection('event_log').distinct('type').catch(() => []);
    return [...new Set(['run', ...evtTypes as string[]])].sort();
  } catch {
    return ['run'];
  }
}
