import { describe, it, expect, vi } from 'vitest';
import { HealthAggregator, type DetailedHealth, type SystemStatus } from '../src/observability/health.js';
import type { Infrastructure } from '../src/infrastructure/types.js';

function createMockInfra(overrides?: {
  stateHealthy?: boolean;
  eventHealthy?: boolean;
  objectStoreHealthy?: boolean;
  channels?: Map<string, { healthy: () => Promise<boolean> }>;
}): Infrastructure {
  return {
    stateStore: {
      healthy: vi.fn().mockResolvedValue(overrides?.stateHealthy ?? true),
      getRawDb: vi.fn().mockReturnValue(null),
    },
    eventBus: {
      healthy: vi.fn().mockReturnValue(overrides?.eventHealthy ?? true),
    },
    objectStore: {
      list: vi.fn().mockResolvedValue(
        overrides?.objectStoreHealthy === false ? null : { keys: [] },
      ),
      healthy: vi.fn().mockResolvedValue(overrides?.objectStoreHealthy ?? true),
    },
    channels: overrides?.channels ?? new Map(),
    secrets: {
      get: vi.fn().mockResolvedValue(undefined),
    },
  } as unknown as Infrastructure;
}

describe('HealthAggregator', () => {
  describe('check()', () => {
    it('reports healthy when all critical components are up', async () => {
      const infra = createMockInfra();
      const agg = new HealthAggregator(infra);
      const result = await agg.check();

      expect(result.healthy).toBe(true);
      expect(result.timestamp).toBeDefined();
      expect(result.components.length).toBeGreaterThanOrEqual(2);
    });

    it('reports unhealthy when stateStore is down', async () => {
      const infra = createMockInfra({ stateHealthy: false });
      const agg = new HealthAggregator(infra);
      const result = await agg.check();

      expect(result.healthy).toBe(false);
    });

    it('reports unhealthy when eventBus is down', async () => {
      const infra = createMockInfra({ eventHealthy: false });
      const agg = new HealthAggregator(infra);
      const result = await agg.check();

      expect(result.healthy).toBe(false);
    });

    it('remains healthy when non-critical objectStore is down', async () => {
      const infra = createMockInfra({ objectStoreHealthy: false });
      const agg = new HealthAggregator(infra);
      const result = await agg.check();

      expect(result.healthy).toBe(true);
    });

    it('includes channel health', async () => {
      const channels = new Map([
        ['discord', { healthy: vi.fn().mockResolvedValue(true) }],
        ['slack', { healthy: vi.fn().mockResolvedValue(false) }],
      ]);
      const infra = createMockInfra({ channels: channels as any });
      const agg = new HealthAggregator(infra);
      const result = await agg.check();

      const discord = result.components.find(c => c.name === 'channel:discord');
      const slack = result.components.find(c => c.name === 'channel:slack');
      expect(discord?.healthy).toBe(true);
      expect(slack?.healthy).toBe(false);
      // System still healthy (channels are non-critical)
      expect(result.healthy).toBe(true);
    });
  });

  describe('isReady()', () => {
    it('returns true when critical deps are available', async () => {
      const infra = createMockInfra();
      const agg = new HealthAggregator(infra);
      expect(await agg.isReady()).toBe(true);
    });

    it('returns false when stateStore is down', async () => {
      const infra = createMockInfra({ stateHealthy: false });
      const agg = new HealthAggregator(infra);
      expect(await agg.isReady()).toBe(false);
    });

    it('returns false when eventBus is down', async () => {
      const infra = createMockInfra({ eventHealthy: false });
      const agg = new HealthAggregator(infra);
      expect(await agg.isReady()).toBe(false);
    });

    it('returns false when stateStore throws', async () => {
      const infra = createMockInfra();
      (infra.stateStore.healthy as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('connection refused'));
      const agg = new HealthAggregator(infra);
      expect(await agg.isReady()).toBe(false);
    });
  });

  describe('checkDetailed()', () => {
    it('returns healthy status when all components up', async () => {
      const infra = createMockInfra();
      const agg = new HealthAggregator(infra);
      const detailed = await agg.checkDetailed();

      expect(detailed.status).toBe('healthy');
      expect(detailed.uptimeSeconds).toBeGreaterThanOrEqual(0);
      expect(detailed.components.stateStore).toBeDefined();
      expect(detailed.components.stateStore!.status).toBe('healthy');
    });

    it('returns degraded when non-critical component is down', async () => {
      const channels = new Map([
        ['discord', { healthy: vi.fn().mockResolvedValue(false) }],
      ]);
      const infra = createMockInfra({ channels: channels as any });
      const agg = new HealthAggregator(infra);
      const detailed = await agg.checkDetailed();

      expect(detailed.status).toBe('degraded');
      expect(detailed.channels.discord?.status).toBe('unhealthy');
    });

    it('returns unhealthy when critical component is down', async () => {
      const infra = createMockInfra({ stateHealthy: false });
      const agg = new HealthAggregator(infra);
      const detailed = await agg.checkDetailed();

      expect(detailed.status).toBe('unhealthy');
    });

    it('includes provided agent and task counts', async () => {
      const infra = createMockInfra();
      const agg = new HealthAggregator(infra);
      const detailed = await agg.checkDetailed({
        agentCounts: { total: 12, active: 8, idle: 4, errored: 0 },
        taskCounts: { pending: 2, running: 1, failedLast24h: 3 },
      });

      expect(detailed.agents.total).toBe(12);
      expect(detailed.agents.active).toBe(8);
      expect(detailed.tasks.pending).toBe(2);
      expect(detailed.tasks.failedLast24h).toBe(3);
    });

    it('includes recent errors when provided', async () => {
      const infra = createMockInfra();
      const agg = new HealthAggregator(infra);
      const detailed = await agg.checkDetailed({
        recentErrors: [
          {
            timestamp: new Date().toISOString(),
            errorCode: 'LLM_TIMEOUT',
            message: 'Anthropic API timeout',
            agentId: 'architect',
            category: 'llm',
            severity: 'warning',
            action: 'Retry or switch provider',
          },
        ],
      });

      expect(detailed.recentErrors.length).toBe(1);
      expect(detailed.recentErrors[0]!.errorCode).toBe('LLM_TIMEOUT');
    });

    it('defaults to zero counts when no context provided', async () => {
      const infra = createMockInfra();
      const agg = new HealthAggregator(infra);
      const detailed = await agg.checkDetailed();

      expect(detailed.agents.total).toBe(0);
      expect(detailed.tasks.pending).toBe(0);
      expect(detailed.recentErrors.length).toBe(0);
    });
  });
});
