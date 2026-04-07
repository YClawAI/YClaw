import { beforeAll, describe, expect, it, vi } from 'vitest';
import { EventBus } from '../src/triggers/event.js';

vi.mock('../src/config/loader.js', () => ({
  loadAllAgentConfigs: () => new Map(),
}));

let AgentRouter: typeof import('../src/agent/router.js').AgentRouter;

beforeAll(async () => {
  ({ AgentRouter } = await import('../src/agent/router.js'));
});

describe('graceful shutdown', () => {
  it('drains in-flight executions before timeout', async () => {
    const router = new AgentRouter();
    router.beginShutdown();

    router.trackExecution('exec-1');
    router.trackExecution('exec-2');

    setTimeout(() => router.untrackExecution('exec-1'), 100);
    setTimeout(() => router.untrackExecution('exec-2'), 200);

    await router.drainExecutions(2000);

    expect(router.activeExecutionCount).toBe(0);
  });

  it('drops publish when event bus is closed', async () => {
    const bus = new EventBus('');
    await bus.close();

    await expect(bus.publish('test', 'event', { ok: true })).resolves.toBeUndefined();
  });
});
