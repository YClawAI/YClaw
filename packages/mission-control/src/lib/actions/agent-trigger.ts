'use server';

import { fetchCoreApi } from '@/lib/core-api';

export async function triggerAgent(agentName: string, task: string): Promise<{ ok: boolean; executionId?: string; error?: string }> {
  const result = await fetchCoreApi<{ executionId?: string }>('/api/trigger', {
    method: 'POST',
    body: JSON.stringify({ agent: agentName, task }),
  });

  if (!result.ok) {
    return { ok: false, error: result.error || 'Trigger failed' };
  }

  return { ok: true, executionId: result.data?.executionId };
}
