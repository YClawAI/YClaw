/**
 * YCLAW Agent Circuit Breaker
 *
 * Rate-limits agent actions to prevent runaway behavior.
 * Tracks consecutive failures, daily PR counts, spend, and deployments.
 */

export interface CircuitBreakerConfig {
  maxConsecutiveFailures: number;
  maxDailyPRs: number;
  maxDailyCostUSD: number;
  maxDailyDeployments: number;
  cooldownMinutes: number;
}

export const DEFAULT_CIRCUIT_BREAKER: CircuitBreakerConfig = {
  maxConsecutiveFailures: 3,
  maxDailyPRs: 10,
  maxDailyCostUSD: 50.0,
  maxDailyDeployments: 5,
  cooldownMinutes: 30,
};

export interface CircuitState {
  consecutiveFailures: number;
  dailyPRs: number;
  dailyCostUSD: number;
  dailyDeployments: number;
  lastFailureAt: Date | null;
  trippedAt: Date | null;
  trippedReason: string | null;
}

export class AgentCircuitBreaker {
  private state: CircuitState;
  private config: CircuitBreakerConfig;

  constructor(config: Partial<CircuitBreakerConfig> = {}) {
    this.config = { ...DEFAULT_CIRCUIT_BREAKER, ...config };
    this.state = {
      consecutiveFailures: 0,
      dailyPRs: 0,
      dailyCostUSD: 0,
      dailyDeployments: 0,
      lastFailureAt: null,
      trippedAt: null,
      trippedReason: null,
    };
  }

  isOpen(): boolean {
    if (!this.state.trippedAt) return false;
    const elapsed = Date.now() - this.state.trippedAt.getTime();
    const cooldownMs = this.config.cooldownMinutes * 60 * 1000;
    if (elapsed >= cooldownMs) {
      this.reset();
      return false;
    }
    return true;
  }

  recordFailure(): void {
    this.state.consecutiveFailures++;
    this.state.lastFailureAt = new Date();
    if (this.state.consecutiveFailures >= this.config.maxConsecutiveFailures) {
      this.trip(`${this.state.consecutiveFailures} consecutive failures`);
    }
  }

  recordSuccess(): void {
    this.state.consecutiveFailures = 0;
  }

  recordPR(): boolean {
    this.state.dailyPRs++;
    if (this.state.dailyPRs > this.config.maxDailyPRs) {
      this.trip(`Daily PR limit exceeded (${this.state.dailyPRs}/${this.config.maxDailyPRs})`);
      return false;
    }
    return true;
  }

  recordCost(usd: number): boolean {
    this.state.dailyCostUSD += usd;
    if (this.state.dailyCostUSD > this.config.maxDailyCostUSD) {
      this.trip(`Daily cost limit exceeded ($${this.state.dailyCostUSD.toFixed(2)}/$${this.config.maxDailyCostUSD.toFixed(2)})`);
      return false;
    }
    return true;
  }

  recordDeployment(): boolean {
    this.state.dailyDeployments++;
    if (this.state.dailyDeployments > this.config.maxDailyDeployments) {
      this.trip(`Daily deployment limit exceeded (${this.state.dailyDeployments}/${this.config.maxDailyDeployments})`);
      return false;
    }
    return true;
  }

  getState(): Readonly<CircuitState> {
    return { ...this.state };
  }

  reset(): void {
    this.state.consecutiveFailures = 0;
    this.state.trippedAt = null;
    this.state.trippedReason = null;
  }

  resetDaily(): void {
    this.state.dailyPRs = 0;
    this.state.dailyCostUSD = 0;
    this.state.dailyDeployments = 0;
  }

  private trip(reason: string): void {
    this.state.trippedAt = new Date();
    this.state.trippedReason = reason;
  }
}
