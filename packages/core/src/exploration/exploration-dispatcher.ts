import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createLogger } from '../logging/logger.js';
import { AgentHubClient } from '../agenthub/client.js';
import type { ExplorationDirective, ExplorationTask } from '../agenthub/types.js';
import { ExplorationWorker } from './exploration-worker.js';

// ─── Constants ─────────────────────────────────────────────────────────────

const DEFAULT_NUM_WORKERS = 2;
const DEFAULT_MAX_ITERATIONS = 3;

// ─── ExplorationDispatcher ─────────────────────────────────────────────────

/**
 * Manages exploration tasks independently of BuilderDispatcher.
 *
 * Listens for 'strategist:exploration_directive' events.
 * Creates initial scaffold in AgentHub, assigns to exploration workers.
 *
 * NO IMPORTS from packages/core/src/builder/*
 */
export class ExplorationDispatcher {
  private readonly log = createLogger('exploration-dispatcher');
  readonly activeTasks = new Map<string, ExplorationTask>();
  /** F5: Tracks which workers have finished (resolved their explore() promise). */
  readonly completedWorkers = new Map<string, Set<string>>();

  constructor(
    private readonly agentHub: AgentHubClient,
    private readonly workerClients: Map<string, AgentHubClient>,
    private readonly githubToken: string,
  ) {}

  async handleDirective(directive: ExplorationDirective): Promise<ExplorationTask> {
    // F10: Derive available workers from configured clients, not hard-coded list
    const availableWorkers = [...this.workerClients.keys()];

    const numWorkers = Math.min(
      Math.max(1, directive.numWorkers || DEFAULT_NUM_WORKERS),
      availableWorkers.length,
    );

    if (availableWorkers.length === 0) {
      throw new Error('No worker clients configured — cannot start exploration');
    }

    this.log.info('Starting exploration', {
      taskId: directive.taskId,
      description: directive.description.slice(0, 100),
      numWorkers,
      availableWorkers,
    });

    const tmpDir = mkdtempSync(join(tmpdir(), `exploration-${directive.taskId}-`));

    try {
      const repoDir = join(tmpDir, 'scaffold');

      // F3: Clone target repo to seed scaffold with actual codebase content
      this.log.info('Cloning target repo for scaffold', { targetRepo: directive.targetRepo });
      execFileSync('git', [
        'clone', '--depth', '1', '--branch', directive.targetBranch,
        `https://x-access-token:${this.githubToken}@github.com/${directive.targetRepo}.git`,
        'scaffold',
      ], { cwd: tmpDir, timeout: 120_000, stdio: 'pipe' });

      // Remove the upstream .git and reinitialize for AgentHub
      rmSync(join(repoDir, '.git'), { recursive: true, force: true });
      git(repoDir, 'init');
      git(repoDir, 'config', 'user.email', 'exploration@yclaw.ai');
      git(repoDir, 'config', 'user.name', 'Exploration Dispatcher');

      // Add scaffold files on top of the real codebase
      writeFileSync(join(repoDir, 'TASK.md'), buildTaskFile(directive));
      writeFileSync(join(repoDir, 'CONTEXT.md'), buildContextFile(directive));

      // Initial commit with full codebase + scaffold
      git(repoDir, 'add', '-A');
      git(repoDir, 'commit', '-m', `scaffold: ${directive.taskId} — ${directive.description.slice(0, 60)}`);

      // Create bundle and push to AgentHub
      const bundlePath = join(tmpDir, 'scaffold.bundle');
      AgentHubClient.createBundle(repoDir, bundlePath, 'HEAD');
      const pushResult = await this.agentHub.pushBundle(bundlePath);

      if (pushResult.hashes.length === 0) {
        throw new Error('Push returned no hashes — scaffold commit was not indexed');
      }

      const rootHash = pushResult.hashes[pushResult.hashes.length - 1]!;
      this.log.info('Scaffold pushed', { rootHash, taskId: directive.taskId });

      // F10: Assign from available workers
      const assignedWorkers = availableWorkers.slice(0, numWorkers);
      const task: ExplorationTask = {
        taskId: directive.taskId,
        description: directive.description,
        context: directive.context,
        rootHash,
        targetRepo: directive.targetRepo,
        targetBranch: directive.targetBranch,
        numWorkers,
        assignedWorkers,
        startedAt: Date.now(),
      };
      this.activeTasks.set(directive.taskId, task);
      this.completedWorkers.set(directive.taskId, new Set());

      // Post to #build-decisions
      await this.agentHub.createPost(
        'build-decisions',
        `## Exploration Started — ${directive.description}\n\n` +
        `**Task ID:** ${directive.taskId}\n` +
        `**Root commit:** \`${rootHash.slice(0, 7)}\`\n` +
        `**Workers assigned:** ${assignedWorkers.join(', ')}\n` +
        `**Target:** ${directive.targetRepo} (${directive.targetBranch})`,
      ).catch((err) => {
        this.log.warn('Failed to post to #build-decisions', { error: (err as Error).message });
      });

      // F5: Track worker completion via promise resolution
      for (const workerId of assignedWorkers) {
        const workerClient = this.workerClients.get(workerId);
        if (!workerClient) {
          this.log.warn('No AgentHub client for worker', { workerId });
          continue;
        }

        const worker = new ExplorationWorker(workerClient, workerId);
        void worker.explore({
          taskId: directive.taskId,
          parentHash: rootHash,
          description: directive.description,
          context: directive.context,
          maxIterations: DEFAULT_MAX_ITERATIONS,
        }).then(() => {
          this.markWorkerComplete(directive.taskId, workerId);
        }).catch((err) => {
          this.log.error('Exploration worker failed', {
            workerId,
            taskId: directive.taskId,
            error: (err as Error).message,
          });
          // Mark as complete even on failure so poller doesn't wait forever
          this.markWorkerComplete(directive.taskId, workerId);
        });
      }

      return task;
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  }

  /**
   * F5: Mark a worker as having finished all its iterations.
   */
  private markWorkerComplete(taskId: string, workerId: string): void {
    const completed = this.completedWorkers.get(taskId);
    if (completed) {
      completed.add(workerId);
      this.log.info('Worker completed', { taskId, workerId, total: completed.size });
    }
  }

  /**
   * F5: Check if all assigned workers for a task have finished.
   */
  allWorkersComplete(taskId: string): boolean {
    const task = this.activeTasks.get(taskId);
    const completed = this.completedWorkers.get(taskId);
    if (!task || !completed) return false;
    return task.assignedWorkers.every((w) => completed.has(w));
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    timeout: 30_000,
    encoding: 'utf-8',
    stdio: 'pipe',
  }).trim();
}

function buildTaskFile(directive: ExplorationDirective): string {
  return `# Exploration Task: ${directive.taskId}

## Description
${directive.description}

## Target
- **Repository:** ${directive.targetRepo}
- **Branch:** ${directive.targetBranch}

## Instructions
Generate a complete solution for the task described above. Your code will be
compared against other approaches. Focus on correctness, architecture, and
readability. The repository source code is included in this scaffold.
`;
}

function buildContextFile(directive: ExplorationDirective): string {
  return `# Context

${directive.context}
`;
}
