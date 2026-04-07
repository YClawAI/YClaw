import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ValidationRunner } from '../src/onboarding/validation.js';

function createMockDb(departments: any[]) {
  return {
    collection: vi.fn(() => ({
      find: vi.fn(() => ({
        toArray: vi.fn(async () => departments),
      })),
    })),
  };
}

describe('ValidationRunner', () => {
  it('reports all departments passing when properly configured', async () => {
    const db = createMockDb([
      {
        slug: 'development',
        name: 'Development',
        agents: ['architect', 'builder'],
        charter: 'Build things well.',
        recurringTasks: ['Review PRs daily'],
        escalationRules: ['CI fail → alert'],
      },
      {
        slug: 'marketing',
        name: 'Marketing',
        agents: ['ember'],
        charter: 'Grow the brand.',
        recurringTasks: ['Weekly content'],
        escalationRules: [],
      },
    ]);

    const runner = new ValidationRunner(db as any);
    const report = await runner.runValidation('session-1');

    expect(report.allPassed).toBe(true);
    expect(report.results.length).toBe(2);
    expect(report.results.every(r => r.passed)).toBe(true);
    expect(report.summary).toContain('2/2');
  });

  it('fails departments without agents', async () => {
    const db = createMockDb([
      {
        slug: 'empty',
        name: 'Empty Dept',
        agents: [],
        charter: 'Do something.',
      },
    ]);

    const runner = new ValidationRunner(db as any);
    const report = await runner.runValidation('session-1');

    expect(report.allPassed).toBe(false);
    expect(report.results[0]!.passed).toBe(false);
    expect(report.results[0]!.details).toContain('No agents assigned');
  });

  it('fails departments without charter', async () => {
    const db = createMockDb([
      {
        slug: 'nocharter',
        name: 'No Charter',
        agents: ['agent1'],
      },
    ]);

    const runner = new ValidationRunner(db as any);
    const report = await runner.runValidation('session-1');

    expect(report.allPassed).toBe(false);
    expect(report.results[0]!.details).toContain('Missing charter');
  });

  it('reports no departments found', async () => {
    const db = createMockDb([]);
    const runner = new ValidationRunner(db as any);
    const report = await runner.runValidation('session-1');

    expect(report.allPassed).toBe(false);
    expect(report.results[0]!.department).toBe('system');
    expect(report.results[0]!.details).toContain('No departments found');
  });

  it('includes recurring task and escalation rule counts', async () => {
    const db = createMockDb([
      {
        slug: 'ops',
        name: 'Operations',
        agents: ['sentinel'],
        charter: 'Keep things running.',
        recurringTasks: ['health check', 'daily report'],
        escalationRules: ['alert on failure'],
      },
    ]);

    const runner = new ValidationRunner(db as any);
    const report = await runner.runValidation('session-1');

    expect(report.results[0]!.details).toContain('2 recurring task(s)');
    expect(report.results[0]!.details).toContain('1 escalation rule(s)');
  });
});
