import { CronJob } from 'cron';
import { createLogger } from '../logging/logger.js';

// ─── Types ──────────────────────────────────────────────────────────────────

interface ScheduledJob {
  agent: string;
  task: string;
  cron: string;
  job: CronJob;
  handler: () => Promise<void>;
}

// ─── CronManager ────────────────────────────────────────────────────────────

/**
 * Manages cron-based triggers for agents. Each agent can register multiple
 * named tasks that fire on a cron schedule. Jobs are keyed by `agent:task`
 * to allow targeted updates and removal.
 */
export class CronManager {
  private readonly log = createLogger('cron-manager');
  private readonly jobs = new Map<string, ScheduledJob>();

  // ─── Schedule ─────────────────────────────────────────────────────────

  schedule(
    agentName: string,
    cronExpression: string,
    taskName: string,
    handler: () => Promise<void>,
  ): void {
    const key = `${agentName}:${taskName}`;

    // Stop existing job for the same key if present
    if (this.jobs.has(key)) {
      this.jobs.get(key)!.job.stop();
      this.log.info('Replacing existing schedule', { agent: agentName, task: taskName });
    }

    const job = CronJob.from({
      cronTime: cronExpression,
      onTick: async () => {
        this.log.info('Cron triggered', { agent: agentName, task: taskName });
        try {
          await handler();
        } catch (err) {
          const error = err instanceof Error ? err.message : String(err);
          this.log.error('Cron handler failed', { agent: agentName, task: taskName, error });
        }
      },
      start: true,
      timeZone: 'UTC',
    });

    this.jobs.set(key, { agent: agentName, task: taskName, cron: cronExpression, job, handler });
    this.log.info('Job scheduled', {
      agent: agentName,
      task: taskName,
      cron: cronExpression,
      nextRun: job.nextDate().toISO(),
    });
  }

  // ─── Update Schedule ──────────────────────────────────────────────────

  updateSchedule(agentName: string, taskName: string, newCron: string): void {
    const key = `${agentName}:${taskName}`;
    const existing = this.jobs.get(key);

    if (!existing) {
      this.log.warn('Cannot update non-existent schedule', { agent: agentName, task: taskName });
      return;
    }

    // CronJob does not support changing the cron expression in-place.
    // Re-create with the stored handler.
    existing.job.stop();

    const newJob = CronJob.from({
      cronTime: newCron,
      onTick: existing.handler,
      start: true,
      timeZone: 'UTC',
    });

    this.jobs.set(key, { ...existing, cron: newCron, job: newJob });
    this.log.info('Schedule updated', {
      agent: agentName,
      task: taskName,
      cron: newCron,
      nextRun: newJob.nextDate().toISO(),
    });
  }

  // ─── Remove All (per agent) ───────────────────────────────────────────

  removeAll(agentName: string): void {
    for (const [key, entry] of this.jobs) {
      if (entry.agent === agentName) {
        entry.job.stop();
        this.jobs.delete(key);
        this.log.info('Job removed', { agent: agentName, task: entry.task });
      }
    }
  }

  // ─── Stop All ─────────────────────────────────────────────────────────

  stopAll(): void {
    for (const [, entry] of this.jobs) {
      entry.job.stop();
    }
    this.jobs.clear();
    this.log.info('All cron jobs stopped');
  }

  // ─── List Schedules ───────────────────────────────────────────────────

  listSchedules(): Array<{ agent: string; task: string; cron: string; nextRun: Date }> {
    const schedules: Array<{ agent: string; task: string; cron: string; nextRun: Date }> = [];

    for (const [, entry] of this.jobs) {
      schedules.push({
        agent: entry.agent,
        task: entry.task,
        cron: entry.cron,
        nextRun: entry.job.nextDate().toJSDate(),
      });
    }

    return schedules;
  }
}
