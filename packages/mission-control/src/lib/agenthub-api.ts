/**
 * Server-side AgentHub API client for Mission Control.
 *
 * MC reads from AgentHub — NEVER writes to it.
 * All calls go through the internal ALB (not public).
 * Graceful fallback: if AgentHub is unreachable, return empty data.
 *
 * Wire schema matches infra/agenthub Go server exactly.
 */

// ─── Config ──────────────────────────────────────────────────────────────────

const AGENTHUB_URL = process.env.AGENTHUB_INTERNAL_URL || 'http://localhost:8080';
const AGENTHUB_API_KEY = process.env.AGENTHUB_MC_API_KEY || '';

// ─── Types (wire schema from infra/agenthub) ────────────────────────────────

export interface AHCommit {
  hash: string;
  parent_hash: string;
  agent_id: string;
  message: string;
  created_at: string;
}

export interface AHChannel {
  id: number;
  name: string;
  description: string;
  created_at: string;
}

export interface AHPost {
  id: number;
  channel_id: number;
  agent_id: string;
  parent_id: number | null;
  content: string;
  created_at: string;
}

export interface AgentHubHealth {
  ok: boolean;
  status: 'healthy' | 'degraded';
  checkedAt: string;
  error?: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const authHeaders = (): HeadersInit => ({
  Authorization: `Bearer ${AGENTHUB_API_KEY}`,
  Accept: 'application/json',
});

async function fetchJSON<T>(path: string, fallback: T, revalidate = 30): Promise<T> {
  try {
    const res = await fetch(`${AGENTHUB_URL}${path}`, {
      headers: authHeaders(),
      next: { revalidate },
    });
    if (!res.ok) return fallback;
    return (await res.json()) as T;
  } catch {
    return fallback;
  }
}

// ─── Git API ─────────────────────────────────────────────────────────────────
// Routes: /api/git/commits, /api/git/leaves, /api/git/commits/{hash}/children,
//         /api/git/commits/{hash}/lineage, /api/git/diff/{a}/{b}

export async function fetchCommits(options?: {
  agent?: string;
  limit?: number;
}): Promise<AHCommit[]> {
  const params = new URLSearchParams();
  if (options?.agent) params.set('agent', options.agent);
  if (options?.limit) params.set('limit', String(options.limit));
  const qs = params.toString();
  return fetchJSON<AHCommit[]>(`/api/git/commits${qs ? `?${qs}` : ''}`, []);
}

export async function fetchLeaves(): Promise<AHCommit[]> {
  return fetchJSON<AHCommit[]>('/api/git/leaves', []);
}

export async function fetchChildren(hash: string): Promise<AHCommit[]> {
  return fetchJSON<AHCommit[]>(`/api/git/commits/${hash}/children`, []);
}

export async function fetchLineage(hash: string): Promise<AHCommit[]> {
  return fetchJSON<AHCommit[]>(`/api/git/commits/${hash}/lineage`, []);
}

export async function fetchDiff(hashA: string, hashB: string): Promise<string> {
  try {
    const res = await fetch(`${AGENTHUB_URL}/api/git/diff/${hashA}/${hashB}`, {
      headers: authHeaders(),
      next: { revalidate: 60 },
    });
    if (!res.ok) return '';
    return res.text();
  } catch {
    return '';
  }
}

// ─── Message Board API ───────────────────────────────────────────────────────
// Routes: /api/channels, /api/channels/{name}/posts

export async function fetchChannels(): Promise<AHChannel[]> {
  return fetchJSON<AHChannel[]>('/api/channels', []);
}

export async function fetchPosts(channel: string, limit?: number): Promise<AHPost[]> {
  const params = new URLSearchParams();
  if (limit) params.set('limit', String(limit));
  const qs = params.toString();
  return fetchJSON<AHPost[]>(`/api/channels/${encodeURIComponent(channel)}/posts${qs ? `?${qs}` : ''}`, []);
}

export async function getAgentHubHealth(): Promise<AgentHubHealth> {
  const checkedAt = new Date().toISOString();

  try {
    const res = await fetch(`${AGENTHUB_URL}/api/channels?limit=1`, {
      headers: authHeaders(),
      next: { revalidate: 15 },
      signal: AbortSignal.timeout(5_000),
    });

    if (!res.ok) {
      return {
        ok: false,
        status: 'degraded',
        checkedAt,
        error: `AgentHub returned ${res.status}`,
      };
    }

    return {
      ok: true,
      status: 'healthy',
      checkedAt,
    };
  } catch (err) {
    return {
      ok: false,
      status: 'degraded',
      checkedAt,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
