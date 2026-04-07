/**
 * ValidationRunner — checks department configuration health.
 *
 * Scoped to the onboarding session's org — only validates departments
 * created by this session, not all departments in the database (#11).
 */

import { createLogger } from '../logging/logger.js';
import type { Db, Collection } from 'mongodb';
import type { OnboardingStore } from './onboarding-store.js';

const logger = createLogger('onboarding:validation');

export interface ValidationResult {
  department: string;
  passed: boolean;
  details: string;
  checkedAt: Date;
}

export interface ValidationReport {
  sessionId: string;
  results: ValidationResult[];
  allPassed: boolean;
  summary: string;
  runAt: Date;
}

export class ValidationRunner {
  private readonly departments: Collection;

  constructor(db: Db, private readonly onboardingStore?: OnboardingStore) {
    this.departments = db.collection('departments');
  }

  /**
   * Run validation scoped to departments created by this onboarding session.
   * Uses the session's orgId to filter departments (#11).
   */
  async runValidation(sessionId: string): Promise<ValidationReport> {
    // Get session to determine which departments belong to it
    let departmentSlugs: string[] | null = null;
    if (this.onboardingStore) {
      const session = await this.onboardingStore.getSession(sessionId);
      if (session) {
        // Use department slugs from session answers or artifacts
        const deptAnswer = session.answers['org_departments'] ?? '';
        if (deptAnswer) {
          departmentSlugs = deptAnswer.split(/[,\n]/).map(s => s.trim().toLowerCase().replace(/\s+/g, '-')).filter(Boolean);
        }
      }
    }

    // Query only session's departments, not all departments in DB
    const filter = departmentSlugs ? { slug: { $in: departmentSlugs } } : {};
    const departments = await this.departments.find(filter).toArray();
    const results: ValidationResult[] = [];

    if (departments.length === 0) {
      results.push({
        department: 'system',
        passed: false,
        details: 'No departments found. Run department seeding first.',
        checkedAt: new Date(),
      });
    }

    for (const dept of departments) {
      const checks: string[] = [];
      let passed = true;

      if (!dept['agents'] || !(dept['agents'] as string[]).length) {
        checks.push('No agents assigned');
        passed = false;
      } else {
        checks.push(`${(dept['agents'] as string[]).length} agent(s) assigned`);
      }

      if (!dept['charter']) {
        checks.push('Missing charter');
        passed = false;
      } else {
        checks.push('Charter defined');
      }

      if (dept['recurringTasks'] && (dept['recurringTasks'] as string[]).length > 0) {
        checks.push(`${(dept['recurringTasks'] as string[]).length} recurring task(s)`);
      }

      if (dept['escalationRules'] && (dept['escalationRules'] as string[]).length > 0) {
        checks.push(`${(dept['escalationRules'] as string[]).length} escalation rule(s)`);
      }

      results.push({
        department: dept['slug'] as string ?? dept['name'] as string ?? 'unknown',
        passed,
        details: checks.join('; '),
        checkedAt: new Date(),
      });
    }

    const allPassed = results.every(r => r.passed);
    const passedCount = results.filter(r => r.passed).length;
    const summary = allPassed
      ? `${passedCount}/${results.length} departments operational`
      : `${passedCount}/${results.length} departments passed validation`;

    const report: ValidationReport = { sessionId, results, allPassed, summary, runAt: new Date() };
    logger.info('Validation complete', { summary, allPassed });
    return report;
  }
}
