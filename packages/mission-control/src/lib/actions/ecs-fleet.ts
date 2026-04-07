'use server';

import { ECSClient, UpdateServiceCommand, DescribeServicesCommand } from '@aws-sdk/client-ecs';

const CLUSTER = process.env.ECS_CLUSTER_NAME || 'yclaw-cluster-production';
const SERVICE = process.env.ECS_SERVICE_NAME || 'yclaw-production';
const NORMAL_DESIRED_COUNT = 1;

export interface EcsFleetStatus {
  desiredCount: number;
  runningCount: number;
  status: 'running' | 'stopped' | 'scaling' | 'error';
}

export async function getEcsFleetStatus(): Promise<EcsFleetStatus> {
  try {
    const ecs = new ECSClient({ region: 'us-east-1' });
    const res = await ecs.send(new DescribeServicesCommand({
      cluster: CLUSTER,
      services: [SERVICE],
    }));
    const svc = res.services?.[0];
    if (!svc) return { desiredCount: 0, runningCount: 0, status: 'error' };

    const desired = svc.desiredCount ?? 0;
    const running = svc.runningCount ?? 0;

    let status: EcsFleetStatus['status'] = 'running';
    if (desired === 0 && running === 0) status = 'stopped';
    else if (desired !== running) status = 'scaling';

    return { desiredCount: desired, runningCount: running, status };
  } catch {
    return { desiredCount: 0, runningCount: 0, status: 'error' };
  }
}

export async function scaleEcsFleet(
  action: 'start' | 'stop'
): Promise<{ ok: boolean; error?: string }> {
  try {
    const ecs = new ECSClient({ region: 'us-east-1' });
    const desiredCount = action === 'start' ? NORMAL_DESIRED_COUNT : 0;

    await ecs.send(new UpdateServiceCommand({
      cluster: CLUSTER,
      service: SERVICE,
      desiredCount,
    }));

    return { ok: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'ECS update failed';
    return { ok: false, error: message };
  }
}
