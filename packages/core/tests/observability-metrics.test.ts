import { describe, it, expect } from 'vitest';
import { NoopMetrics, type IMetrics } from '../src/observability/metrics.js';

describe('IMetrics / NoopMetrics', () => {
  it('NoopMetrics implements IMetrics', () => {
    const metrics: IMetrics = new NoopMetrics();
    expect(metrics).toBeDefined();
    expect(typeof metrics.incrementCounter).toBe('function');
    expect(typeof metrics.observeHistogram).toBe('function');
    expect(typeof metrics.setGauge).toBe('function');
  });

  it('NoopMetrics methods are callable without error', () => {
    const metrics = new NoopMetrics();

    // Should not throw
    metrics.incrementCounter('yclaw_tasks_total', { agent: 'architect', status: 'completed' });
    metrics.incrementCounter('yclaw_tasks_total', { agent: 'architect' }, 5);
    metrics.observeHistogram('yclaw_task_duration_seconds', 1.234, { agent: 'builder' });
    metrics.setGauge('yclaw_health_status', 1, { component: 'stateStore' });
  });

  it('NoopMetrics can be used as default without side effects', () => {
    const metrics = new NoopMetrics();

    // Call many times — should be zero overhead
    for (let i = 0; i < 1000; i++) {
      metrics.incrementCounter('yclaw_events_total', { type: 'github:ci_pass' });
    }

    // No assertions needed beyond not throwing
    expect(true).toBe(true);
  });
});
