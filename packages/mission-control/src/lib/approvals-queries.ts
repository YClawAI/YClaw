import { fetchCoreApi } from './core-api';

export interface ApprovalItem {
  id: string;
  agentId: string;
  status: string;
  title: string;
  description: string;
  createdAt: string;
  repo?: string;
  prNumber?: number;
  type?: string;
  riskLevel?: string;
  requiresHuman?: boolean;
}

interface CoreApprovalRecord {
  id: string;
  type: string;
  requiresHuman: boolean;
  requestedBy?: { agentId?: string; department?: string };
  payload?: Record<string, unknown>;
  reasoning?: string;
  riskLevel?: string;
  status: string;
  requestedAt?: string;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function mapApproval(doc: CoreApprovalRecord): ApprovalItem {
  const payload = doc.payload ?? {};
  const title = asString(payload.title) ?? asString(payload.name) ?? doc.type;
  const description = asString(payload.description) ?? doc.reasoning ?? '';
  const repo = asString(payload.repo) ?? asString(payload.repoUrl);
  const prNumber = asNumber(payload.prNumber) ?? asNumber(payload.pullNumber);

  return {
    id: doc.id,
    agentId: doc.requestedBy?.agentId ?? 'unknown',
    status: doc.status,
    title,
    description,
    createdAt: doc.requestedAt ?? '',
    ...(repo ? { repo } : {}),
    ...(prNumber !== undefined ? { prNumber } : {}),
    type: doc.type,
    riskLevel: doc.riskLevel,
    requiresHuman: doc.requiresHuman,
  };
}

async function fetchApprovals(status?: string): Promise<ApprovalItem[]> {
  const params = new URLSearchParams();
  if (status === 'pending') {
    params.set('status', 'pending');
  }

  const query = params.toString();
  const result = await fetchCoreApi<{ approvals?: CoreApprovalRecord[] }>(
    `/api/approvals${query ? `?${query}` : ''}`,
    { cache: 'no-store' },
  );

  if (!result.ok) return [];
  const approvals = (result.data?.approvals ?? []).map(mapApproval);

  if (status && status !== 'pending') {
    return approvals.filter((approval) => approval.status === status);
  }

  return approvals;
}

export async function getPendingApprovalCount(): Promise<number> {
  return (await fetchApprovals('pending')).length;
}

export async function getApprovals(status?: string): Promise<ApprovalItem[]> {
  return fetchApprovals(status);
}
