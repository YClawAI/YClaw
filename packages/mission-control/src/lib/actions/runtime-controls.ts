'use server';

import { revalidatePath } from 'next/cache';
import { fetchCoreApi } from '@/lib/core-api';

async function publishControlEvent(
  source: string,
  type: string,
  payload: Record<string, unknown>,
): Promise<{ ok: boolean; error?: string }> {
  const result = await fetchCoreApi<{ published?: boolean }>('/api/events/publish', {
    method: 'POST',
    body: JSON.stringify({ source, type, payload }),
  });

  if (!result.ok) {
    return { ok: false, error: result.error || 'Failed to publish control event' };
  }

  return { ok: true };
}

export async function pauseGrowth(channel?: string): Promise<{ ok: boolean; error?: string }> {
  const result = await publishControlEvent('strategist', 'growth_pause', channel ? { channel } : {});
  if (result.ok) revalidatePath('/departments/marketing');
  return result;
}

export async function resumeGrowth(channel?: string): Promise<{ ok: boolean; error?: string }> {
  const result = await publishControlEvent('strategist', 'growth_resume', channel ? { channel } : {});
  if (result.ok) revalidatePath('/departments/marketing');
  return result;
}

const APPROVAL_KEY_PATTERN = /^[\w:.-]+$/;

export async function approveGrowth(approvalKey: string): Promise<{ ok: boolean; error?: string }> {
  if (!approvalKey || !APPROVAL_KEY_PATTERN.test(approvalKey)) {
    return { ok: false, error: 'Invalid approval key format' };
  }
  const result = await publishControlEvent('strategist', 'growth_approved', { approval_key: approvalKey });
  if (result.ok) revalidatePath('/departments/marketing');
  return result;
}

const REPO_PATTERN = /^[\w.-]+\/[\w.-]+$/;
const BRANCH_PATTERN = /^[\w./-]+$/;

export async function launchExplorationDirective(input: {
  taskId: string;
  description: string;
  context: string;
  numWorkers: number;
  targetRepo: string;
  targetBranch: string;
}): Promise<{ ok: boolean; error?: string }> {
  const taskId = input.taskId.trim();
  const description = input.description.trim();
  const context = input.context.trim();
  const targetRepo = input.targetRepo.trim();
  const targetBranch = input.targetBranch.trim();
  const numWorkers = Math.max(1, Math.min(3, Math.round(input.numWorkers || 2)));

  if (!taskId || !description || !context || !targetRepo || !targetBranch) {
    return { ok: false, error: 'taskId, description, context, targetRepo, and targetBranch are required' };
  }

  if (!REPO_PATTERN.test(targetRepo)) {
    return { ok: false, error: 'targetRepo must match owner/repo format (e.g. yclaw-ai/yclaw)' };
  }

  if (!BRANCH_PATTERN.test(targetBranch)) {
    return { ok: false, error: 'targetBranch contains invalid characters' };
  }

  const result = await publishControlEvent('strategist', 'exploration_directive', {
    taskId,
    description,
    context,
    numWorkers,
    targetRepo,
    targetBranch,
  });

  if (result.ok) revalidatePath('/departments/development');
  return result;
}
