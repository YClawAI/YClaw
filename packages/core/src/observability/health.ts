/**
 * HealthAggregator — Aggregates health status from all infrastructure adapters.
 *
 * Provides a single health check endpoint that reports the status of
 * every adapter (state store, event bus, channels, etc.).
 *
 * Phase 5 additions: DetailedHealth, readiness check, uptime tracking.
 */

import type { Infrastructure } from '../infrastructure/types.js';
import { createLogger } from '../logging/logger.js';

const logger = createLogger('health-aggregator');

export interface ComponentHealth {
  name: string;
  healthy: boolean;
  latencyMs?: number;
  error?: string;
}

export interface SystemHealth {
  healthy: boolean;
  timestamp: string;
  components: ComponentHealth[];
}

/** Overall system status for detailed health. */
export type SystemStatus = 'healthy' | 'degraded' | 'unhealthy';

/** Channel status within detailed health. */
export interface ChannelHealthDetail {
  status: 'healthy' | 'disabled' | 'unhealthy';
  error?: string;
}

/** Detailed health response — authenticated endpoint. */
export interface DetailedHealth {
  status: SystemStatus;
  uptimeSeconds: number;
  timestamp: string;
  components: Record<string, {
    status: 'healthy' | 'unhealthy';
    latencyMs?: number;
    error?: string;
  }>;
  channels: Record<string, ChannelHealthDetail>;
  agents: {
    total: number;
    active: number;
    idle: number;
    errored: number;
  };
  tasks: {
    pending: number;
    running: number;
    failedLast24h: number;
  };
  recentErrors: Array<{
    timestamp: string;
    errorCode?: string;
    message: string;
    agentId?: string;
    category?: string;
    severity?: string;
    action?: string;
  }>;
}

export class HealthAggregator {
  private readonly infra: Infrastructure;

  constructor(infra: Infrastructure) {
    this.infra = infra;
  }

  /**
   * Check health of all infrastructure components.
   * The system is considered healthy if all critical components are healthy.
   * Channels are non-critical — their failure doesn't make the system unhealthy.
   */
  async check(): Promise<SystemHealth> {
    const components: ComponentHealth[] = [];

    // State store (critical)
    components.push(await this.checkComponent('stateStore', () => this.infra.stateStore.healthy()));

    // Event bus (critical)
    components.push(this.checkSync('eventBus', () => this.infra.eventBus.healthy()));

    // Object store (non-critical — local filesystem is always available)
    components.push(await this.checkComponent('objectStore', async () => {
      // Basic liveness: try to list with 0 keys
      const result = await this.infra.objectStore.list('__health__', 1);
      return result !== null;
    }));

    // Channels (non-critical)
    for (const [name, channel] of this.infra.channels) {
      components.push(await this.checkComponent(`channel:${name}`, () => channel.healthy()));
    }

    // Critical components determine overall health
    const criticalComponents = components.filter(c =>
      c.name === 'stateStore' || c.name === 'eventBus',
    );
    const healthy = criticalComponents.every(c => c.healthy);

    const result: SystemHealth = {
      healthy,
      timestamp: new Date().toISOString(),
      components,
    };

    if (!healthy) {
      logger.warn('System health check failed', {
        unhealthy: components.filter(c => !c.healthy).map(c => c.name),
      });
    }

    return result;
  }

  /**
   * Readiness check — are critical dependencies available?
   * Returns true only if stateStore and eventBus are healthy.
   */
  async isReady(): Promise<boolean> {
    try {
      const stateHealthy = await this.infra.stateStore.healthy();
      const eventHealthy = this.infra.eventBus.healthy();
      return stateHealthy && eventHealthy;
    } catch {
      return false;
    }
  }

  /**
   * Detailed health check — full breakdown with agent/task counts and recent errors.
   * Used by the authenticated /v1/observability/health endpoint.
   */
  async checkDetailed(context?: {
    agentCounts?: { total: number; active: number; idle: number; errored: number };
    taskCounts?: { pending: number; running: number; failedLast24h: number };
    recentErrors?: DetailedHealth['recentErrors'];
  }): Promise<DetailedHealth> {
    const systemHealth = await this.check();

    // Map components to detailed format
    const components: DetailedHealth['components'] = {};
    const channels: DetailedHealth['channels'] = {};

    for (const comp of systemHealth.components) {
      if (comp.name.startsWith('channel:')) {
        const channelName = comp.name.slice('channel:'.length);
        channels[channelName] = {
          status: comp.healthy ? 'healthy' : 'unhealthy',
          error: comp.error,
        };
      } else {
        components[comp.name] = {
          status: comp.healthy ? 'healthy' : 'unhealthy',
          latencyMs: comp.latencyMs,
          error: comp.error,
        };
      }
    }

    // Determine overall status
    const criticalHealthy = systemHealth.healthy;
    const anyComponentUnhealthy = systemHealth.components.some(c => !c.healthy);
    let status: SystemStatus = 'healthy';
    if (!criticalHealthy) {
      status = 'unhealthy';
    } else if (anyComponentUnhealthy) {
      status = 'degraded';
    }

    return {
      status,
      uptimeSeconds: Math.floor(process.uptime()),
      timestamp: systemHealth.timestamp,
      components,
      channels,
      agents: context?.agentCounts ?? { total: 0, active: 0, idle: 0, errored: 0 },
      tasks: context?.taskCounts ?? { pending: 0, running: 0, failedLast24h: 0 },
      recentErrors: context?.recentErrors ?? [],
    };
  }

  private async checkComponent(
    name: string,
    check: () => Promise<boolean>,
  ): Promise<ComponentHealth> {
    const start = Date.now();
    try {
      const healthy = await check();
      return { name, healthy, latencyMs: Date.now() - start };
    } catch (err) {
      return {
        name,
        healthy: false,
        latencyMs: Date.now() - start,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private checkSync(
    name: string,
    check: () => boolean,
  ): ComponentHealth {
    try {
      return { name, healthy: check() };
    } catch (err) {
      return {
        name,
        healthy: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
