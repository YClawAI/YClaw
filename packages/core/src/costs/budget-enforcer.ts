import type { Db } from 'mongodb';
import type { Redis } from 'ioredis';
import type { AgentBudget, BudgetCheckResult, BudgetMode, GlobalBudgetConfig } from './types.js';
import type { CostTracker } from './cost-tracker.js';
import type { EventBus } from '../triggers/event.js';
import { createLogger } from '../logging/logger.js';

const logger = createLogger('budget-enforcer');

const BUDGET_COLLECTION = 'agent_budgets';

/** How often to reload budgets from MongoDB (ms). Catches manual DB edits. */
const BUDGET_RELOAD_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

// ─── Default Budgets ─────────────────────────────────────────────────────────

const DEFAULT_BUDGETS: Record<string, Partial<AgentBudget>> = {
  strategist:   { dailyLimitCents: 1500 },
  builder:      { dailyLimitCents: 2000 },
  architect:    { dailyLimitCents: 500 },
  deployer:     { dailyLimitCents: 500 },
  designer:     { dailyLimitCents: 500 },
  sentinel:     { dailyLimitCents: 500 },
  reviewer:     { dailyLimitCents: 500 },
  treasurer:    { dailyLimitCents: 500 },
  scout:        { dailyLimitCents: 500 },
  ember:        { dailyLimitCents: 500 },
  forge:        { dailyLimitCents: 500 },
  guide:        { dailyLimitCents: 500 },
  keeper:       { dailyLimitCents: 500 },
};

export class BudgetEnforcer {
  private db: Db | null;
  private redis: Redis | null;
  private costTracker: CostTracker;
  private eventBus: EventBus;
  private budgetCache = new Map<string, AgentBudget>();
  private lastReloadAt = 0;
  private initialized = false;
  private systemMode: BudgetMode =
    (process.env.BUDGET_MODE as BudgetMode) === 'enforcing' ? 'enforcing'
    : (process.env.BUDGET_MODE as BudgetMode) === 'off' ? 'off'
    : 'tracking';
  private globalConfig: GlobalBudgetConfig | null = null;

  constructor(db: Db | null, redis: Redis | null, costTracker: CostTracker, eventBus: EventBus) {
    this.db = db;
    this.redis = redis;
    this.costTracker = costTracker;
    this.eventBus = eventBus;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    if (this.db) {
      try {
        const col = this.db.collection(BUDGET_COLLECTION);
        await col.createIndex({ agentId: 1 }, { unique: true });

        // Seed default budgets for agents that don't have one
        for (const [agentId, overrides] of Object.entries(DEFAULT_BUDGETS)) {
          const existing = await col.findOne({ agentId });
          if (!existing) {
            const budget: AgentBudget = {
              agentId,
              dailyLimitCents: overrides.dailyLimitCents ?? 500,
              monthlyLimitCents: (overrides.dailyLimitCents ?? 500) * 30,
              alertThresholdPercent: 80,
              action: 'alert',
            };
            await col.insertOne(budget);
            logger.info(`Seeded budget for ${agentId}: $${budget.dailyLimitCents / 100}/day`);
          }
        }

        await this.loadBudgetsFromDb();
        logger.info(`Budget enforcer loaded ${this.budgetCache.size} budgets (mode: ${this.systemMode})`);
      } catch (err) {
        logger.warn(`Budget enforcer initialization failed (non-fatal): ${err}`);
      }
    }

    this.initialized = true;
  }

  /**
   * Reload budgets from MongoDB into the in-memory cache.
   * Called on initialize() and automatically when the TTL expires.
   */
  async reloadBudgets(): Promise<void> {
    if (!this.db) return;
    try {
      await this.loadBudgetsFromDb();
      logger.info(`Budget cache refreshed: ${this.budgetCache.size} budgets loaded (mode: ${this.systemMode})`);
    } catch (err) {
      logger.warn(`Budget cache refresh failed (non-fatal): ${err}`);
    }
  }

  private async loadBudgetsFromDb(): Promise<void> {
    if (!this.db) return;

    // Load per-agent budgets
    const all = await this.db.collection(BUDGET_COLLECTION).find({}).toArray();
    this.budgetCache.clear();
    for (const doc of all) {
      this.budgetCache.set(doc.agentId as string, doc as unknown as AgentBudget);
    }

    // Load global budget config — use defaults when no doc exists so enforcement
    // is active out-of-the-box (matches what the UI displays via getBudgetConfig)
    try {
      const configDoc = await this.db.collection('budget_config').findOne({ _id: 'global' as unknown as import('mongodb').ObjectId });
      this.globalConfig = {
        dailyLimitCents: (configDoc?.globalDailyLimitCents as number | undefined) ?? 5000,
        monthlyLimitCents: (configDoc?.globalMonthlyLimitCents as number | undefined) ?? 100000,
        action: (configDoc?.globalAction as GlobalBudgetConfig['action'] | undefined) ?? 'alert',
        alertThresholdPercent: (configDoc?.globalAlertThresholdPercent as number | undefined) ?? 80,
      };
      const mode = configDoc?.mode as string | undefined;
      if (mode === 'enforcing' || mode === 'tracking' || mode === 'off') {
        this.systemMode = mode;
      }
    } catch (err) {
      logger.warn(`Global budget config load failed (non-fatal): ${err}`);
      // Still set defaults if DB read fails
      if (!this.globalConfig) {
        this.globalConfig = {
          dailyLimitCents: 5000,
          monthlyLimitCents: 100000,
          action: 'alert',
          alertThresholdPercent: 80,
        };
      }
    }

    this.lastReloadAt = Date.now();
  }

  private async maybeReloadBudgets(): Promise<void> {
    if (Date.now() - this.lastReloadAt > BUDGET_RELOAD_INTERVAL_MS) {
      await this.reloadBudgets();
    }
  }

  /** Get the current system budget mode. */
  getMode(): BudgetMode {
    return this.systemMode;
  }

  /**
   * Check if an agent is within budget before execution starts.
   * Returns the check result — caller decides whether to proceed.
   *
   * Respects system mode:
   * - 'off': returns allowed immediately, no checks
   * - 'tracking': runs all checks, records spend, fires alerts, but always returns allowed
   * - 'enforcing': current behavior (block if over limit with pause/hard_stop action)
   */
  async check(agentId: string): Promise<BudgetCheckResult> {
    // Refresh budget cache if stale
    await this.maybeReloadBudgets();

    // Mode: off — skip everything
    if (this.systemMode === 'off') {
      return {
        allowed: true,
        dailySpentCents: 0,
        dailyLimitCents: 0,
        dailyPercent: 0,
        monthlySpentCents: 0,
        monthlyLimitCents: 0,
        monthlyPercent: 0,
      };
    }

    const isTracking = this.systemMode === 'tracking';

    // ── Global fleet budget check ──
    if (this.globalConfig) {
      const [fleetDaily, fleetMonthly] = await Promise.all([
        this.costTracker.getFleetDailySpendCents(),
        this.costTracker.getFleetMonthlySpendCents(),
      ]);

      const globalDailyPct = this.globalConfig.dailyLimitCents > 0
        ? Math.round((fleetDaily / this.globalConfig.dailyLimitCents) * 100)
        : 0;
      const globalMonthlyPct = this.globalConfig.monthlyLimitCents > 0
        ? Math.round((fleetMonthly / this.globalConfig.monthlyLimitCents) * 100)
        : 0;

      // Alert threshold
      if (globalDailyPct >= this.globalConfig.alertThresholdPercent && globalDailyPct < 100) {
        await this.publishBudgetWarningDeduped(
          '__fleet__', fleetDaily, this.globalConfig.dailyLimitCents, globalDailyPct,
        );
      }

      // Check if fleet is over limit
      const fleetOverDaily = fleetDaily >= this.globalConfig.dailyLimitCents;
      const fleetOverMonthly = fleetMonthly >= this.globalConfig.monthlyLimitCents;

      if (fleetOverDaily || fleetOverMonthly) {
        const limitType = fleetOverDaily ? 'daily' : 'monthly';
        const spent = fleetOverDaily ? fleetDaily : fleetMonthly;
        const limit = fleetOverDaily ? this.globalConfig.dailyLimitCents : this.globalConfig.monthlyLimitCents;

        if (this.globalConfig.action === 'pause' || this.globalConfig.action === 'hard_stop') {
          if (!isTracking) {
            const reason = `Global fleet budget exceeded: ${limitType} limit of $${(limit / 100).toFixed(2)} (spent: $${(spent / 100).toFixed(2)})`;
            logger.warn(reason);
            this.publishBudgetExceeded('__fleet__', spent, limit, this.globalConfig.action);
            return {
              allowed: false,
              reason,
              dailySpentCents: fleetDaily,
              dailyLimitCents: this.globalConfig.dailyLimitCents,
              dailyPercent: globalDailyPct,
              monthlySpentCents: fleetMonthly,
              monthlyLimitCents: this.globalConfig.monthlyLimitCents,
              monthlyPercent: globalMonthlyPct,
            };
          }
          // Tracking mode — log but don't block
          logger.info(`Global fleet budget exceeded (tracking mode): ${limitType} limit`);
        }
        this.publishBudgetExceeded('__fleet__', spent, limit, isTracking ? 'alert' : this.globalConfig.action);
      }
    }

    // ── Per-agent budget check ──
    const budget = this.budgetCache.get(agentId);
    if (!budget) {
      return {
        allowed: true,
        dailySpentCents: 0,
        dailyLimitCents: 0,
        dailyPercent: 0,
        monthlySpentCents: 0,
        monthlyLimitCents: 0,
        monthlyPercent: 0,
      };
    }

    const [dailySpent, monthlySpent] = await Promise.all([
      this.costTracker.getDailySpendCents(agentId),
      this.costTracker.getMonthlySpendCents(agentId),
    ]);

    const dailyPercent = budget.dailyLimitCents > 0
      ? Math.round((dailySpent / budget.dailyLimitCents) * 100)
      : 0;
    const monthlyPercent = budget.monthlyLimitCents > 0
      ? Math.round((monthlySpent / budget.monthlyLimitCents) * 100)
      : 0;

    const result: BudgetCheckResult = {
      allowed: true,
      dailySpentCents: dailySpent,
      dailyLimitCents: budget.dailyLimitCents,
      dailyPercent,
      monthlySpentCents: monthlySpent,
      monthlyLimitCents: budget.monthlyLimitCents,
      monthlyPercent,
    };

    // Check alert threshold — deduplicated via Redis
    if (dailyPercent >= budget.alertThresholdPercent && dailyPercent < 100) {
      logger.warn(`Budget warning: ${agentId} at ${dailyPercent}% of daily limit`);
      await this.publishBudgetWarningDeduped(agentId, dailySpent, budget.dailyLimitCents, dailyPercent);
    }

    // Check if over limit
    const overDaily = dailySpent >= budget.dailyLimitCents;
    const overMonthly = monthlySpent >= budget.monthlyLimitCents;

    if (overDaily || overMonthly) {
      const limitType = overDaily ? 'daily' : 'monthly';
      const spent = overDaily ? dailySpent : monthlySpent;
      const limit = overDaily ? budget.dailyLimitCents : budget.monthlyLimitCents;

      if (budget.action === 'pause' || budget.action === 'hard_stop') {
        if (!isTracking) {
          result.allowed = false;
          result.reason = `Budget exceeded: ${agentId} hit ${limitType} limit of $${(limit / 100).toFixed(2)} (spent: $${(spent / 100).toFixed(2)})`;
          logger.warn(result.reason);
          this.publishBudgetExceeded(agentId, spent, limit, budget.action);
        } else {
          // Tracking mode — log but don't block
          result.tracked = true;
          logger.info(`Budget exceeded (tracking mode): ${agentId} hit ${limitType} limit`);
          this.publishBudgetExceeded(agentId, spent, limit, 'alert');
        }
      } else {
        // action === 'alert' — just warn, don't block
        this.publishBudgetExceeded(agentId, spent, limit, 'alert');
      }
    }

    return result;
  }

  getBudget(agentId: string): AgentBudget | undefined {
    return this.budgetCache.get(agentId);
  }

  /**
   * Publish a budget warning event, deduplicated per agent per day.
   */
  private async publishBudgetWarningDeduped(
    agentId: string,
    spentCents: number,
    limitCents: number,
    percent: number,
  ): Promise<void> {
    if (this.redis) {
      try {
        const today = new Date().toISOString().slice(0, 10);
        const dedupKey = `budget:warned:${agentId}:${today}`;
        const wasSet = await this.redis.set(dedupKey, '1', 'EX', 86400, 'NX');
        if (wasSet === null) return;
      } catch (err) {
        logger.warn(`Budget warning dedup check failed (non-fatal): ${err}`);
      }
    }

    void this.eventBus.publish('system', 'agent:budget_warning', {
      agentId,
      spentCents,
      limitCents,
      percent,
      message: `:warning: Budget Warning: ${agentId} at ${percent}% of daily limit ($${(spentCents / 100).toFixed(2)}/$${(limitCents / 100).toFixed(2)})`,
    });
  }

  private publishBudgetExceeded(
    agentId: string,
    spentCents: number,
    limitCents: number,
    action: string,
  ): void {
    const actionLabel = action === 'pause' ? 'PAUSED' : action === 'hard_stop' ? 'STOPPED' : 'OVER LIMIT';
    void this.eventBus.publish('system', 'agent:budget_exceeded', {
      agentId,
      spentCents,
      limitCents,
      action,
      message: `:rotating_light: Budget Exceeded: ${agentId} ${actionLabel} — hit daily limit of $${(limitCents / 100).toFixed(2)}`,
    });
  }
}
