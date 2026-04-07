'use server';

import { fetchCoreApi } from '@/lib/core-api';

const ID_PATTERN = /^[\w:.-]+$/;

export async function decideApproval(approvalId: string, decision: 'approve' | 'reject'): Promise<{ ok: boolean; error?: string }> {
  if (!approvalId || !ID_PATTERN.test(approvalId)) {
    return { ok: false, error: 'Invalid approval ID format' };
  }
  const decidedBy = process.env.MISSION_CONTROL_APPROVER_ID || 'mission-control';
  const result = await fetchCoreApi<{ approval?: unknown }>('/api/approvals/decide', {
    method: 'POST',
    body: JSON.stringify({
      id: approvalId,
      decision: decision === 'approve' ? 'approved' : 'rejected',
      decidedBy,
    }),
  });

  if (!result.ok) {
    return { ok: false, error: result.error || 'Approval decision failed' };
  }

  return { ok: true };
}
