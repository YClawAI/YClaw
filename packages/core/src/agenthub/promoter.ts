import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Octokit } from '@octokit/rest';
import { createLogger } from '../logging/logger.js';
import { AgentHubClient } from './client.js';
import type { PromoteOptions } from './types.js';

// ─── Constants ─────────────────────────────────────────────────────────────

/** Files created by the exploration scaffold — never promoted to target repo */
const SCAFFOLD_FILES = new Set(['TASK.md', 'CONTEXT.md', '.gitkeep']);

const log = createLogger('agenthub-promoter');

// ─── AgentHubPromoter ──────────────────────────────────────────────────────

/**
 * Takes a winning AgentHub commit and opens a GitHub PR on the target repo.
 *
 * This is the ONLY point where AgentHub touches the existing pipeline.
 * The PR it creates is indistinguishable from a human-opened PR.
 * The existing webhook pipeline handles everything from there.
 */
export class AgentHubPromoter {
  private readonly octokit: Octokit;

  constructor(
    private readonly agentHub: AgentHubClient,
    private readonly githubToken: string,
  ) {
    this.octokit = new Octokit({ auth: githubToken });
  }

  async promote(options: PromoteOptions): Promise<{ prNumber: number; prUrl: string }> {
    const {
      winningHash,
      taskId,
      taskDescription,
      targetRepo,
      targetBranch,
      reviewDecision,
      competingApproaches,
    } = options;

    const shortHash = winningHash.slice(0, 7);
    const branchName = `exploration/${taskId}/${shortHash}`;
    const tmpDir = mkdtempSync(join(tmpdir(), 'promote-'));
    const [owner, repo] = targetRepo.split('/') as [string, string];

    // F14: Use git credential store file instead of embedding token in URL
    const credFile = join(tmpDir, '.git-credentials');

    try {
      // Write credential store file with restrictive permissions
      writeFileSync(credFile, `https://x-access-token:${this.githubToken}@github.com\n`, { mode: 0o600 });

      // 1. Clone target repo (shallow) using credential helper
      const cloneDir = join(tmpDir, 'target');
      log.info('Cloning target repo', { targetRepo, targetBranch });
      execFileSync('git', [
        '-c', `credential.helper=store --file=${credFile}`,
        'clone', '--depth', '1', '--branch', targetBranch,
        `https://github.com/${targetRepo}.git`, 'target',
      ], { cwd: tmpDir, timeout: 60_000, stdio: 'pipe' });

      // F14: Configure credential helper for push (post-clone)
      git(cloneDir, 'config', 'credential.helper', `store --file=${credFile}`);

      // F12: Set git user identity
      git(cloneDir, 'config', 'user.email', 'exploration@yclaw.ai');
      git(cloneDir, 'config', 'user.name', 'YClaw Exploration');

      // 2. Create feature branch
      git(cloneDir, 'checkout', '-b', branchName);

      // 3. Fetch winning commit from AgentHub
      const bundlePath = join(tmpDir, 'winning.bundle');
      await this.agentHub.fetchCommit(winningHash, bundlePath);

      // 4. Unbundle into a separate temp repo to extract files
      const extractDir = join(tmpDir, 'extract');
      git(tmpDir, 'init', 'extract');
      AgentHubClient.unbundle(extractDir, bundlePath);
      git(extractDir, 'checkout', winningHash);

      // F9: Use git diff to detect additions, modifications, AND deletions
      // Get the root commit (first parent in lineage) to diff against
      const rootHash = git(extractDir, 'rev-list', '--max-parents=0', 'HEAD');

      let diffOutput: string;
      try {
        diffOutput = git(extractDir, 'diff', '--name-status', rootHash, 'HEAD');
      } catch {
        // If root == HEAD, no diff — use all files
        diffOutput = '';
      }

      if (diffOutput) {
        // Process each change (A=added, M=modified, D=deleted, R=renamed)
        for (const line of diffOutput.split('\n')) {
          if (!line.trim()) continue;
          const parts = line.split('\t');
          const status = parts[0]!;
          const filePath = parts[parts.length - 1]!; // For renames, last is destination

          // Skip scaffold files
          if (SCAFFOLD_FILES.has(filePath)) continue;

          if (status === 'D') {
            // F9: Apply deletions
            const dest = join(cloneDir, filePath);
            if (existsSync(dest)) unlinkSync(dest);
          } else if (status === 'A' || status === 'M' || status.startsWith('R')) {
            // Copy added/modified/renamed files
            const src = join(extractDir, filePath);
            const dest = join(cloneDir, filePath);
            const destDir = join(dest, '..');
            if (!existsSync(destDir)) {
              execFileSync('mkdir', ['-p', destDir]);
            }
            if (existsSync(src)) {
              execFileSync('cp', [src, dest]);
            }
          }
        }
      } else {
        // Fallback: copy all non-scaffold files
        // F8: Only filter exact .git directory, not .github/ etc.
        const filesToCopy = listFiles(extractDir).filter(
          (f) => !SCAFFOLD_FILES.has(f),
        );

        for (const relPath of filesToCopy) {
          const src = join(extractDir, relPath);
          const dest = join(cloneDir, relPath);
          const destDir = join(dest, '..');
          if (!existsSync(destDir)) {
            execFileSync('mkdir', ['-p', destDir]);
          }
          execFileSync('cp', [src, dest]);
        }
      }

      // 5. Commit + push
      git(cloneDir, 'add', '-A');

      // Check if there are staged changes
      try {
        git(cloneDir, 'diff', '--cached', '--quiet');
        throw new Error('No changes to promote — winning commit matches target repo');
      } catch (err) {
        // diff --quiet exits non-zero when there ARE changes (which is what we want)
        if ((err as Error).message.includes('No changes to promote')) throw err;
      }

      const commitMsg = `${taskDescription} (via AgentHub exploration)`;
      git(cloneDir, 'commit', '-m', commitMsg);
      git(cloneDir, 'push', 'origin', branchName);

      // F4: Open PR via Octokit API (not gh CLI, which is not in the Docker image)
      const prBody = buildPrBody({
        taskDescription,
        shortHash,
        winnerAgent: competingApproaches.find(a => a.hash === winningHash)?.agent ?? 'unknown',
        competingApproaches,
        reviewDecision,
      });

      const { data: pr } = await this.octokit.pulls.create({
        owner,
        repo,
        title: taskDescription,
        body: prBody,
        head: branchName,
        base: targetBranch,
      });

      log.info('PR created', { prUrl: pr.html_url, prNumber: pr.number, branchName });
      return { prNumber: pr.number, prUrl: pr.html_url };
    } finally {
      // 8. Clean up temp dirs (including credential file)
      rmSync(tmpDir, { recursive: true, force: true });
    }
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    timeout: 60_000,
    encoding: 'utf-8',
    stdio: 'pipe',
  }).trim();
}

/**
 * Recursively list all files in a directory (relative paths).
 * F8: Only skips the exact .git directory, preserving .github/, .gitignore, etc.
 */
function listFiles(dir: string, prefix = ''): string[] {
  const result: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.name === '.git') continue; // Only exact .git directory
    if (entry.isDirectory()) {
      result.push(...listFiles(join(dir, entry.name), rel));
    } else {
      result.push(rel);
    }
  }
  return result;
}

function buildPrBody(opts: {
  taskDescription: string;
  shortHash: string;
  winnerAgent: string;
  competingApproaches: Array<{ hash: string; agent: string; message: string }>;
  reviewDecision: string;
}): string {
  const approachesList = opts.competingApproaches
    .map((a) => `- \`${a.hash.slice(0, 7)}\` by ${a.agent} — ${a.message}`)
    .join('\n');

  return `## AgentHub Exploration — ${opts.taskDescription}

**Winning approach:** \`${opts.shortHash}\` by ${opts.winnerAgent}

### Competing Approaches Evaluated
${approachesList}

### Reviewer Decision
${opts.reviewDecision}

---
*Promoted from AgentHub exploration. ${opts.competingApproaches.length} approaches were evaluated.*
*This PR follows the standard review/merge/deploy pipeline.*`;
}
