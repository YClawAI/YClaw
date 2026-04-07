'use server';

import {
  runCronJob,
  toggleCronJob,
  toggleSkill,
  restartGateway,
  patchConfig,
  applyConfig,
} from '@/lib/openclaw';

interface ActionResult {
  ok: boolean;
  error?: string;
}

export async function serverRunCronJob(jobId: string): Promise<ActionResult> {
  try {
    const success = await runCronJob(jobId);
    return success ? { ok: true } : { ok: false, error: 'Gateway returned failure' };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

export async function serverToggleCronJob(jobId: string, enabled: boolean): Promise<ActionResult> {
  try {
    const success = await toggleCronJob(jobId, enabled);
    return success ? { ok: true } : { ok: false, error: 'Gateway returned failure' };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

export async function serverToggleSkill(name: string, enabled: boolean): Promise<ActionResult> {
  try {
    const success = await toggleSkill(name, enabled);
    return success ? { ok: true } : { ok: false, error: 'Gateway returned failure' };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

export async function serverRestartGateway(): Promise<ActionResult> {
  try {
    const success = await restartGateway('Restart from Mission Control');
    return success ? { ok: true } : { ok: false, error: 'Gateway returned failure' };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

export async function serverPatchConfig(patch: Record<string, unknown>): Promise<ActionResult> {
  try {
    const success = await patchConfig(patch);
    return success ? { ok: true } : { ok: false, error: 'Gateway returned failure' };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

export async function serverApplyConfig(options?: { restart?: boolean; note?: string }): Promise<ActionResult> {
  try {
    const note = options?.note ?? 'Applied from Mission Control';
    const success = options?.restart
      ? await restartGateway(note)
      : await applyConfig(note);
    return success ? { ok: true } : { ok: false, error: 'Gateway returned failure' };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

export async function serverSaveOpenClawSettings(settings: {
  model?: string;
  temperature?: number;
}): Promise<ActionResult> {
  try {
    const patch: Record<string, unknown> = {};
    if (settings.model !== undefined) patch.model = settings.model;
    if (settings.temperature !== undefined) patch.temperature = settings.temperature;

    if (Object.keys(patch).length === 0) {
      return { ok: true };
    }

    const success = await patchConfig(patch);
    if (!success) return { ok: false, error: 'Gateway returned failure' };

    const applied = await applyConfig('Settings updated from Mission Control');
    return applied ? { ok: true } : { ok: false, error: 'Config saved but failed to apply' };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}
