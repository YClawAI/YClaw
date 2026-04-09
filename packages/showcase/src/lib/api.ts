const API_URL = process.env.YCLAW_PUBLIC_API_URL || 'https://agents.yclaw.ai';

export async function fetchPublicApi<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${API_URL}/public/v1${path}`, {
      next: { revalidate: 10 },
    });
    if (!res.ok) return null;
    return res.json() as Promise<T>;
  } catch {
    return null;
  }
}

export interface PublicAgent {
  name: string;
  role: string;
  department: string;
  status: 'idle' | 'running' | 'error' | 'offline';
}

export interface PublicEvent {
  id: string;
  timestamp: string;
  agentName: string;
  type: string;
  summary: string;
}

export interface PublicQueueStats {
  pending: number;
  running: number;
  completed24h: number;
  failed24h: number;
}

export interface PublicDepartment {
  name: string;
  agentCount: number;
  activeTaskCount: number;
}

export interface PublicStatus {
  status: 'operational' | 'degraded' | 'down';
  activeAgents: number;
  totalTasksToday: number;
}
