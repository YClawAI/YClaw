/**
 * Department seeder — creates department configs from approved DEPARTMENTS.yaml artifact.
 *
 * Maps ingested assets to departments based on classification.
 * Uses department presets as fallback when the artifact doesn't specify full config.
 */

import type { Db, Collection } from 'mongodb';
import YAML from 'yaml';
import { createLogger } from '../logging/logger.js';
import { getDepartmentPreset, getDepartmentPresetNames } from './department-presets.js';
import type { OnboardingSession, OnboardingAsset, DepartmentPreset } from './types.js';
import type { DepartmentName } from './constants.js';

const logger = createLogger('onboarding:department-seeder');

/** Department config as stored in MongoDB. */
export interface DepartmentConfig {
  name: string;
  slug: string;
  description: string;
  charter: string;
  agents: string[];
  recurringTasks: string[];
  escalationRules: string[];
  assets: string[];
  createdAt: Date;
  createdBy: string;
}

/** Asset-to-department mapping based on classification. */
const CLASSIFICATION_TO_DEPARTMENT: Record<string, string> = {
  technical_spec: 'development',
  brand_asset: 'marketing',
  process_doc: 'operations',
  support_doc: 'support',
  strategy_doc: 'executive',
  financial_doc: 'finance',
};

export class DepartmentSeeder {
  private readonly collection: Collection<DepartmentConfig>;

  constructor(db: Db) {
    this.collection = db.collection<DepartmentConfig>('departments');
  }

  async ensureIndexes(): Promise<void> {
    await this.collection.createIndex({ slug: 1 }, { unique: true });
  }

  /**
   * Seed departments from an onboarding session.
   *
   * Reads the approved DEPARTMENTS.yaml artifact, enriches with preset defaults,
   * maps assets, and stores in MongoDB.
   */
  async seedFromSession(session: OnboardingSession, operatorId: string): Promise<DepartmentConfig[]> {
    // Find the approved departments artifact
    const deptArtifact = session.artifacts.find(
      a => a.type === 'departments' && a.status === 'approved',
    );

    let departmentNames: string[];

    if (deptArtifact) {
      // Parse YAML from artifact
      try {
        const parsed = YAML.parse(deptArtifact.content) as unknown;
        if (Array.isArray(parsed)) {
          departmentNames = parsed.map((d: any) => String(d.name ?? d).toLowerCase());
        } else if (typeof parsed === 'object' && parsed !== null) {
          departmentNames = Object.keys(parsed);
        } else {
          departmentNames = getDepartmentPresetNames();
        }
      } catch {
        logger.warn('Failed to parse DEPARTMENTS.yaml artifact, using presets');
        departmentNames = getDepartmentPresetNames();
      }
    } else {
      // No artifact — use departments from answers or default presets
      const deptAnswer = session.answers['org_departments'] ?? '';
      if (deptAnswer) {
        departmentNames = deptAnswer
          .split(/[,\n]/)
          .map(s => s.trim().toLowerCase())
          .filter(Boolean);
      } else {
        departmentNames = getDepartmentPresetNames();
      }
    }

    // Build department configs
    const configs: DepartmentConfig[] = [];
    const assetMap = this.mapAssetsToDeparts(session.assets);

    for (const name of departmentNames) {
      const slug = name.toLowerCase().replace(/\s+/g, '-');
      const presetNames = getDepartmentPresetNames();
      const preset = presetNames.includes(slug as DepartmentName)
        ? getDepartmentPreset(slug as DepartmentName)
        : this.createFallbackPreset(name);

      const config: DepartmentConfig = {
        name: preset.name,
        slug,
        description: preset.description,
        charter: preset.charter,
        agents: preset.agents,
        recurringTasks: preset.recurringTasks,
        escalationRules: preset.escalationRules,
        assets: assetMap.get(slug) ?? [],
        createdAt: new Date(),
        createdBy: operatorId,
      };

      configs.push(config);
    }

    // Upsert to MongoDB
    for (const config of configs) {
      await this.collection.updateOne(
        { slug: config.slug },
        { $set: config },
        { upsert: true },
      );
    }

    logger.info(`Seeded ${configs.length} departments`, {
      departments: configs.map(c => c.slug),
    });

    return configs;
  }

  /** Map ingested assets to departments based on classification. */
  private mapAssetsToDeparts(assets: OnboardingAsset[]): Map<string, string[]> {
    const map = new Map<string, string[]>();

    for (const asset of assets) {
      // Use explicit department assignment if available
      const dept = asset.department
        ?? CLASSIFICATION_TO_DEPARTMENT[asset.classification]
        ?? 'general';

      const existing = map.get(dept) ?? [];
      existing.push(asset.assetId);
      map.set(dept, existing);
    }

    return map;
  }

  private createFallbackPreset(name: string): DepartmentPreset {
    return {
      name: name.charAt(0).toUpperCase() + name.slice(1),
      description: `${name} department`,
      charter: `Manage ${name} operations.`,
      agents: [],
      recurringTasks: [],
      escalationRules: [],
    };
  }
}
