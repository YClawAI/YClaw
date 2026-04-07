import type { Db, ObjectId } from 'mongodb';
import { createLogger } from '../logging/logger.js';

const logger = createLogger('settings-overlay');

/** Per-agent overrides from Mission Control */
export interface AgentOverrides {
  model?: string;
  temperature?: number;
  cronEnabled?: Record<string, boolean>;
  eventEnabled?: Record<string, boolean>;
}

/** Department-level overrides from MongoDB org_settings */
export interface DepartmentOverrides {
  directive?: string;
  agents?: Record<string, AgentOverrides>;
}

/** How often to reload overrides from MongoDB (ms). Matches BudgetEnforcer. */
const CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Loads department-level operational overrides from MongoDB org_settings.
 * YAML remains the source of truth for agent structure (actions, triggers, integrations).
 * MongoDB overlays operational settings (model, temperature, directive, toggles).
 *
 * Cache behavior matches BudgetEnforcer: 5-minute TTL, graceful degradation.
 */
export class SettingsOverlay {
  private cache = new Map<string, { data: DepartmentOverrides; loadedAt: number }>();
  private db: Db | null;

  constructor(db: Db | null) {
    this.db = db;
  }

  /**
   * Load department overrides from MongoDB org_settings.
   * Returns null if DB unavailable or no document exists.
   */
  async getDepartmentOverrides(department: string): Promise<DepartmentOverrides | null> {
    if (!this.db) return null;

    const cached = this.cache.get(department);
    if (cached && Date.now() - cached.loadedAt < CACHE_TTL_MS) {
      return cached.data;
    }

    try {
      const doc = await this.db.collection('org_settings').findOne({
        _id: `dept_${department}` as unknown as ObjectId,
      });
      if (!doc) return null;

      const overrides: DepartmentOverrides = {
        directive: doc.directive as string | undefined,
        agents: doc.agents as Record<string, AgentOverrides> | undefined,
      };

      this.cache.set(department, { data: overrides, loadedAt: Date.now() });
      return overrides;
    } catch (err) {
      logger.warn(`Failed to load overrides for ${department}`, {
        error: err instanceof Error ? err.message : String(err),
      });
      return null; // Graceful degradation — use YAML defaults
    }
  }

  /**
   * Convenience: get combined department + agent-specific overrides.
   * Returns null if no overrides exist.
   */
  async getAgentOverrides(department: string, agentName: string): Promise<{
    directive?: string;
    model?: string;
    temperature?: number;
    cronEnabled?: Record<string, boolean>;
    eventEnabled?: Record<string, boolean>;
  } | null> {
    const dept = await this.getDepartmentOverrides(department);
    if (!dept) return null;

    const agent = dept.agents?.[agentName];
    return {
      directive: dept.directive,
      model: agent?.model,
      temperature: agent?.temperature,
      cronEnabled: agent?.cronEnabled,
      eventEnabled: agent?.eventEnabled,
    };
  }

  /** Clear cache (for testing or forced refresh). */
  clearCache(): void {
    this.cache.clear();
  }
}
