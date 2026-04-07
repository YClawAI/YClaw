/**
 * IMetrics — pluggable metrics interface.
 *
 * Default: NoopMetrics (disabled). Swap in PrometheusMetrics or
 * an OpenTelemetry adapter when needed.
 *
 * Call sites instrument counters, histograms, and gauges. They become
 * live when a real adapter is plugged in.
 */

export interface IMetrics {
  /** Increment a counter by 1 (or by `value` if provided). */
  incrementCounter(name: string, labels?: Record<string, string>, value?: number): void;

  /** Record an observation in a histogram (e.g., request duration). */
  observeHistogram(name: string, value: number, labels?: Record<string, string>): void;

  /** Set a gauge to an absolute value. */
  setGauge(name: string, value: number, labels?: Record<string, string>): void;
}

/**
 * NoopMetrics — default implementation that discards all metrics.
 * Zero overhead, zero dependencies.
 */
export class NoopMetrics implements IMetrics {
  incrementCounter(): void { /* noop */ }
  observeHistogram(): void { /* noop */ }
  setGauge(): void { /* noop */ }
}
