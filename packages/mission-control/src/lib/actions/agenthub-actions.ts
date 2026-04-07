'use server';

import { fetchDiff } from '@/lib/agenthub-api';

/**
 * Server action to fetch a diff between two AgentHub commits.
 * Called from client components (ExplorationDAG) on demand.
 */
export async function getAgentHubDiff(hashA: string, hashB: string): Promise<string> {
  return fetchDiff(hashA, hashB);
}
