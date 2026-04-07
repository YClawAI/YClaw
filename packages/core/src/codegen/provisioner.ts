import { randomUUID } from 'node:crypto';
import {
  mkdirSync,
  rmSync,
  existsSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  cpSync,
  appendFileSync,
  statSync,
} from 'node:fs';
import { join, resolve, relative, sep } from 'node:path';
import { spawn as nodeSpawn } from 'node:child_process';
import { createLogger } from '../logging/logger.js';
import type { RepoConfig } from '../config/repo-schema.js';
import type { Workspace } from './types.js';
import { SESSION_RULES, REFLECTION_PROMPT } from './types.js';
import { spawnCli } from './backends/spawn-cli.js';
import { prePushSecretScan, sanitizeForClaudeMd, redactSecrets } from './secrets.js';

const logger = createLogger('provisioner');

// ─── Workspace Provisioner ──────────────────────────────────────────────────
//
// Lifecycle: create → clone → branch → provision → (execute) → collect → push → cleanup
//
// Provisioner owns the workspace filesystem. Backends only get the workspace
// path and operate within it.
//

/** Base directory for all codegen workspaces (writable on Fargate) */
const WORKSPACES_BASE = resolve(
  process.env.CODEGEN_WORKSPACES_DIR || '/app/tmp/codegen',
);

/** Bundled meta skills directory (copied into Docker image at build time) */
const CODEGEN_SKILLS_DIR = resolve(
  process.env.CODEGEN_SKILLS_DIR || '/app/skills',
);

/** Max age for stale workspace cleanup (1 hour) */
const STALE_WORKSPACE_MS = 60 * 60 * 1000;

export class WorkspaceProvisioner {
  /**
   * Create a fresh workspace directory structure.
   */
  createWorkspace(repoConfig: RepoConfig, branchName: string): Workspace {
    const id = `ws-${randomUUID().slice(0, 8)}`;
    const basePath = join(WORKSPACES_BASE, id);
    const repoPath = join(basePath, 'repo');
    const outputPath = join(basePath, 'output');

    // Restrict workspace base to owner-only (contains .git-credentials)
    mkdirSync(basePath, { recursive: true, mode: 0o700 });
    mkdirSync(repoPath, { recursive: true });
    mkdirSync(outputPath, { recursive: true });

    logger.info('Workspace created', { id, basePath });

    return {
      id,
      repoConfig,
      basePath,
      repoPath,
      outputPath,
      branch: branchName,
      state: 'creating',
      createdAt: new Date(),
    };
  }

  /**
   * Clone the target repo into the workspace.
   * Uses git credential store file instead of embedding token in URLs.
   * The credentials file lives at workspace.basePath (outside the repo),
   * so it won't be scanned by pre-push secret detection or committed.
   */
  async cloneRepo(workspace: Workspace): Promise<void> {
    workspace.state = 'cloning';
    const { github } = workspace.repoConfig;
    const token = process.env.GITHUB_TOKEN || '';

    // Write git credentials file (outside repo dir, cleaned up with workspace)
    const credPath = join(workspace.basePath, '.git-credentials');
    if (token) {
      writeFileSync(credPath, `https://x-access-token:${token}@github.com\n`, { mode: 0o600 });
    }

    // Clean URL — no embedded token
    const cloneUrl = `https://github.com/${github.owner}/${github.repo}.git`;

    const credentialArgs = token
      ? ['-c', `credential.helper=store --file=${credPath}`]
      : [];

    const result = await spawnCli({
      command: 'git',
      args: [
        ...credentialArgs,
        'clone',
        '--depth', '1',
        '--branch', github.default_branch,
        cloneUrl,
        workspace.repoPath,
      ],
      cwd: workspace.basePath,
      env: {
        GIT_TERMINAL_PROMPT: '0',
      },
      timeout_ms: 120_000,
    });

    if (result.exit_code !== 0) {
      throw new Error(
        `Git clone failed (exit ${result.exit_code}): ${redactSecrets(result.stderr.slice(0, 500))}`,
      );
    }

    // Configure credential helper in repo's .git/config so CLI subprocess
    // git operations (push, fetch) work without GITHUB_TOKEN in env
    if (token) {
      await spawnCli({
        command: 'git',
        args: ['config', 'credential.helper', `store --file=${credPath}`],
        cwd: workspace.repoPath,
        env: {},
        timeout_ms: 5_000,
      });
    }

    // Validate workspace size
    const sizeResult = await spawnCli({
      command: 'du',
      args: ['-sm', workspace.repoPath],
      cwd: workspace.basePath,
      env: {},
      timeout_ms: 10_000,
    });

    if (sizeResult.exit_code === 0) {
      const sizeMb = parseInt(sizeResult.stdout.split('\t')[0] || '0', 10);
      const maxMb = workspace.repoConfig.codegen.max_workspace_mb;
      if (sizeMb > maxMb) {
        logger.warn('Workspace exceeds size limit', { sizeMb, maxMb });
      }
    }

    logger.info('Repo cloned', {
      repo: `${github.owner}/${github.repo}`,
      branch: github.default_branch,
    });
  }

  /**
   * Create a feature branch for the codegen session.
   */
  async createBranch(workspace: Workspace): Promise<void> {
    const gitEnv = {
      GIT_AUTHOR_NAME: 'YClaw Builder Agent',
      GIT_AUTHOR_EMAIL: 'builder@yclaw.ai',
      GIT_COMMITTER_NAME: 'YClaw Builder Agent',
      GIT_COMMITTER_EMAIL: 'builder@yclaw.ai',
    };

    const result = await spawnCli({
      command: 'git',
      args: ['checkout', '-b', workspace.branch],
      cwd: workspace.repoPath,
      env: gitEnv,
      timeout_ms: 10_000,
    });

    if (result.exit_code !== 0) {
      throw new Error(
        `Branch creation failed (exit ${result.exit_code}): ${result.stderr.slice(0, 500)}`,
      );
    }

    logger.info('Branch created', { branch: workspace.branch });
  }

  /**
   * Provision CLAUDE.md, codex.md, and skills into the workspace.
   *
   * Config flow:
   *   Repo's CLAUDE.md (canonical, committed)
   *   + engineering-standards.md (from yclaw prompts)
   *   + session rules (agent identity, task context)
   *   → .claude/CLAUDE.md (ephemeral, gitignored)
   *   → codex.md (ephemeral, gitignored)
   */
  provisionConfig(workspace: Workspace, task: string): void {
    workspace.state = 'provisioning';
    const { repoPath, repoConfig } = workspace;

    // Read canonical CLAUDE.md from repo (if exists)
    const canonicalPath = join(repoPath, repoConfig.codegen.claude_md_path);
    let canonicalContent = '';
    if (existsSync(canonicalPath)) {
      canonicalContent = readFileSync(canonicalPath, 'utf-8');
    }

    // Collect subdirectory CLAUDE.md files for hierarchical context
    const subdirClaudeMds = this.collectSubdirClaudeMds(repoPath);

    // Read engineering standards from yclaw prompts
    let standardsContent = '';
    const standardsPath = resolve(
      import.meta.dirname, '..', '..', '..', '..', 'prompts', 'engineering-standards.md',
    );
    if (existsSync(standardsPath)) {
      standardsContent = readFileSync(standardsPath, 'utf-8');
    }

    // Compose the ephemeral CLAUDE.md for Claude Code
    const composedClaudeMd = this.composeClaudeMd(
      canonicalContent,
      standardsContent,
      task,
      repoConfig,
      subdirClaudeMds,
    );

    // Write .claude/CLAUDE.md (ephemeral)
    const claudeDir = join(repoPath, '.claude');
    mkdirSync(claudeDir, { recursive: true });
    writeFileSync(join(claudeDir, 'CLAUDE.md'), composedClaudeMd);

    // Write codex.md (same content, adapted format for Codex)
    writeFileSync(join(repoPath, 'codex.md'), composedClaudeMd);

    // Write opencode.json (instructions field for OpenCode)
    writeFileSync(
      join(repoPath, 'opencode.json'),
      JSON.stringify({ instructions: composedClaudeMd }, null, 2),
    );

    // Add ephemeral files to .gitignore
    this.ensureGitignore(repoPath, [
      '.claude/CLAUDE.md',
      'codex.md',
      'opencode.json',
    ]);

    // Copy meta skills into workspace
    this.provisionSkills(workspace);

    logger.info('Config provisioned', {
      workspace: workspace.id,
      hasCanonical: canonicalContent.length > 0,
    });
  }

  /**
   * Copy bundled meta skills AND repo-specific skills into the workspace.
   */
  private provisionSkills(workspace: Workspace): void {
    const skillsTarget = join(workspace.repoPath, '.claude', 'skills');
    mkdirSync(skillsTarget, { recursive: true });

    // Copy universal meta skills (from Docker image / skills/)
    if (existsSync(CODEGEN_SKILLS_DIR)) {
      const skillDirs = readdirSync(CODEGEN_SKILLS_DIR, { withFileTypes: true })
        .filter(d => d.isDirectory());

      for (const dir of skillDirs) {
        const src = join(CODEGEN_SKILLS_DIR, dir.name);
        const dest = join(skillsTarget, dir.name);
        cpSync(src, dest, { recursive: true });
      }

      logger.info('Meta skills provisioned', {
        count: skillDirs.length,
      });
    }

    // Copy repo-specific skills (from git clone, if any)
    const repoSkillsDir = join(workspace.repoPath, 'skills');
    if (existsSync(repoSkillsDir)) {
      const repoSkills = readdirSync(repoSkillsDir, { withFileTypes: true })
        .filter(d => d.isDirectory());

      for (const dir of repoSkills) {
        const src = join(repoSkillsDir, dir.name);
        const dest = join(skillsTarget, dir.name);
        if (!existsSync(dest)) {
          cpSync(src, dest, { recursive: true });
        }
      }

      logger.info('Repo skills provisioned', {
        count: repoSkills.length,
      });
    }
  }

  /**
   * Walk the repo tree and collect CLAUDE.md files from subdirectories.
   * Provides hierarchical, per-module context (deeper files override shallower).
   */
  private collectSubdirClaudeMds(
    repoPath: string,
  ): Array<{ relativePath: string; content: string }> {
    const IGNORE_DIRS = new Set([
      'node_modules', '.git', '.claude', 'dist', 'build', 'coverage',
    ]);
    const MAX_FILES = 10;
    const MAX_FILE_BYTES = 8 * 1024; // 8KB per file

    const results: Array<{ relativePath: string; content: string }> = [];

    const walk = (dir: string): void => {
      if (results.length >= MAX_FILES) return;

      let entries;
      try {
        entries = readdirSync(dir, { withFileTypes: true });
      } catch {
        return; // Permission denied or missing — skip
      }

      for (const entry of entries) {
        if (results.length >= MAX_FILES) return;

        if (entry.isDirectory()) {
          if (IGNORE_DIRS.has(entry.name)) continue;
          walk(join(dir, entry.name));
        } else if (entry.name === 'CLAUDE.md') {
          const fullPath = join(dir, entry.name);
          const relDir = relative(repoPath, dir);
          // Skip root — already read as canonical
          if (!relDir) continue;

          try {
            let content = readFileSync(fullPath, 'utf-8');
            if (Buffer.byteLength(content, 'utf-8') > MAX_FILE_BYTES) {
              content = content.slice(0, MAX_FILE_BYTES) + '\n\n<!-- truncated (>8KB) -->';
            }
            results.push({ relativePath: relDir, content });
          } catch {
            // Unreadable file — skip
          }
        }
      }
    };

    walk(repoPath);

    // Sort by path depth (shallowest first)
    results.sort(
      (a, b) => a.relativePath.split(sep).length - b.relativePath.split(sep).length,
    );

    if (results.length > 0) {
      logger.info('Subdirectory CLAUDE.md files collected', {
        count: results.length,
        paths: results.map(r => r.relativePath),
      });
    }

    return results;
  }

  /**
   * Compose the ephemeral CLAUDE.md from canonical + standards + session rules.
   */
  private composeClaudeMd(
    canonical: string,
    standards: string,
    task: string,
    repoConfig: RepoConfig,
    subdirClaudeMds: Array<{ relativePath: string; content: string }> = [],
  ): string {
    const sections: string[] = [];

    sections.push(`# ${repoConfig.name} — Codegen Session`);
    sections.push('');
    sections.push(`**Repo:** ${repoConfig.github.owner}/${repoConfig.github.repo}`);
    sections.push(`**Stack:** ${repoConfig.tech_stack.language}${repoConfig.tech_stack.framework ? ` / ${repoConfig.tech_stack.framework}` : ''}`);
    sections.push(`**Task:** ${task}`);
    sections.push('');

    if (canonical) {
      sections.push('---');
      sections.push('');
      sections.push('## Repo Knowledge (from CLAUDE.md)');
      sections.push('');
      sections.push(canonical);
      sections.push('');
    } else {
      sections.push('---');
      sections.push('');
      sections.push('## No CLAUDE.md Found — Create One');
      sections.push('');
      sections.push('This repo has no CLAUDE.md yet. **Before starting the main task**, create one:');
      sections.push('1. Explore the repo structure (key files, components, data flow)');
      sections.push('2. Create a CLAUDE.md at the repo root documenting:');
      sections.push('   - Architecture overview (main components and how they connect)');
      sections.push('   - Key files and their responsibilities');
      sections.push('   - Build, test, and deploy commands');
      sections.push('   - Conventions and patterns used');
      sections.push('   - Known issues or gotchas');
      sections.push('3. This file is institutional memory — every future agent reads it first');
      sections.push('4. Then proceed with the main task');
      sections.push('');
    }

    // Append per-directory CLAUDE.md overrides (hierarchical context)
    for (const subdir of subdirClaudeMds) {
      sections.push('---');
      sections.push('');
      sections.push(`## Module: ${subdir.relativePath}`);
      sections.push('');
      sections.push(subdir.content);
      sections.push('');
    }

    if (standards) {
      sections.push('---');
      sections.push('');
      sections.push(standards);
      sections.push('');
    }

    sections.push('---');
    sections.push('');
    sections.push('## Session Rules');
    sections.push('');
    sections.push(SESSION_RULES);
    sections.push('');

    return sections.join('\n');
  }

  /**
   * Ensure entries exist in .gitignore.
   */
  private ensureGitignore(repoPath: string, entries: string[]): void {
    const gitignorePath = join(repoPath, '.gitignore');
    let content = '';
    if (existsSync(gitignorePath)) {
      content = readFileSync(gitignorePath, 'utf-8');
    }

    const linesToAdd = entries.filter(e => !content.includes(e));
    if (linesToAdd.length > 0) {
      const suffix = '\n# Codegen ephemeral files\n' + linesToAdd.join('\n') + '\n';
      appendFileSync(gitignorePath, suffix);
    }
  }

  /**
   * Run post-execution checks: tests, lint, build.
   */
  async runPostChecks(
    workspace: Workspace,
  ): Promise<{ tests: boolean; lint: boolean; build: boolean }> {
    const { tech_stack } = workspace.repoConfig;
    const cwd = workspace.repoPath;
    const env = { PATH: process.env.PATH || '' };

    const results = { tests: true, lint: true, build: true };

    // Install dependencies (safe mode unless repo is explicitly trusted)
    if (existsSync(join(cwd, 'package.json'))) {
      const pm = tech_stack.package_manager;
      const isTrusted = workspace.repoConfig.trust_level === 'trusted';
      const installArgs = isTrusted
        ? ['install']
        : ['install', '--ignore-scripts'];

      if (!isTrusted) {
        logger.info('Installing in sandboxed mode (--ignore-scripts)', {
          workspace: workspace.id,
        });
      }

      await spawnCli({
        command: pm,
        args: installArgs,
        cwd,
        env,
        timeout_ms: 120_000,
      });
    }

    if (tech_stack.test_command) {
      const [cmd, ...args] = tech_stack.test_command.split(' ');
      if (cmd) {
        const r = await spawnCli({ command: cmd, args, cwd, env, timeout_ms: 300_000 });
        results.tests = r.exit_code === 0;
      }
    }

    if (tech_stack.lint_command) {
      const [cmd, ...args] = tech_stack.lint_command.split(' ');
      if (cmd) {
        const r = await spawnCli({ command: cmd, args, cwd, env, timeout_ms: 60_000 });
        results.lint = r.exit_code === 0;
      }
    }

    if (tech_stack.build_command) {
      const [cmd, ...args] = tech_stack.build_command.split(' ');
      if (cmd) {
        const r = await spawnCli({ command: cmd, args, cwd, env, timeout_ms: 300_000 });
        results.build = r.exit_code === 0;
      }
    }

    logger.info('Post-checks complete', { workspace: workspace.id, results });
    return results;
  }

  /**
   * Capture browser evidence (screenshots) for frontend repos.
   * Runs AFTER codegen but BEFORE commitAndPush.
   * Returns array of local artifact paths saved to workspace output/.
   */
  async captureBrowserEvidence(workspace: Workspace): Promise<string[]> {
    const frontendConfig = workspace.repoConfig.codegen.frontend;
    if (!frontendConfig?.browser_evidence) return [];

    const baseUrl = frontendConfig.base_url || 'http://localhost:3000';
    const startCommand = frontendConfig.start_command;
    const smokePaths = frontendConfig.smoke_paths;
    const artifacts: string[] = [];

    logger.info('Capturing browser evidence', {
      workspace: workspace.id,
      baseUrl,
      smokePaths,
    });

    // Start dev server if a start command is provided
    let serverProcess: { kill: () => void } | null = null;
    if (startCommand) {
      const [cmd, ...args] = startCommand.split(' ');
      if (cmd) {
        // Fire-and-forget the dev server
        serverProcess = nodeSpawn(cmd, args, {
          cwd: workspace.repoPath,
          stdio: 'ignore',
          detached: true,
          env: { ...process.env, PORT: new URL(baseUrl).port || '3000' },
        });

        // Wait for server ready (poll with retries, max 30s)
        const maxWait = 30_000;
        const interval = 1_000;
        const start = Date.now();
        let ready = false;

        while (Date.now() - start < maxWait) {
          try {
            const healthCheck = await spawnCli({
              command: 'curl',
              args: ['-s', '-o', '/dev/null', '-w', '%{http_code}', baseUrl],
              cwd: workspace.repoPath,
              env: {},
              timeout_ms: 5_000,
            });
            if (healthCheck.stdout.trim().startsWith('2') || healthCheck.stdout.trim() === '304') {
              ready = true;
              break;
            }
          } catch {
            // Server not ready yet
          }
          await new Promise(r => setTimeout(r, interval));
        }

        if (!ready) {
          logger.warn('Dev server did not become ready within 30s', {
            workspace: workspace.id,
          });
          try { serverProcess.kill(); } catch { /* ignore */ }
          return [];
        }
      }
    }

    try {
      // Capture screenshots for each smoke path
      for (const smokePath of smokePaths) {
        const url = new URL(smokePath, baseUrl).href;
        const safeName = smokePath.replace(/[^a-zA-Z0-9]/g, '_');
        const outputFile = join(workspace.outputPath, `screenshot${safeName}.png`);

        const result = await spawnCli({
          command: 'npx',
          args: ['playwright', 'screenshot', url, outputFile],
          cwd: workspace.repoPath,
          env: { PATH: process.env.PATH || '' },
          timeout_ms: 30_000,
        });

        if (result.exit_code === 0 && existsSync(outputFile)) {
          artifacts.push(outputFile);
          logger.info('Screenshot captured', { url, outputFile });
        } else {
          logger.warn('Screenshot capture failed', {
            url,
            exit_code: result.exit_code,
            stderr: result.stderr.slice(0, 200),
          });
        }
      }
    } finally {
      // Kill dev server
      if (serverProcess) {
        try { serverProcess.kill(); } catch { /* ignore */ }
      }
    }

    logger.info('Browser evidence capture complete', {
      workspace: workspace.id,
      artifacts: artifacts.length,
    });

    return artifacts;
  }

  /**
   * Commit all changes and push the branch.
   */
  async commitAndPush(
    workspace: Workspace,
    message: string,
  ): Promise<{ sha?: string; pushed: boolean }> {
    workspace.state = 'pushing';
    const cwd = workspace.repoPath;
    const gitEnv = {
      GIT_AUTHOR_NAME: 'YClaw Builder Agent',
      GIT_AUTHOR_EMAIL: 'builder@yclaw.ai',
      GIT_COMMITTER_NAME: 'YClaw Builder Agent',
      GIT_COMMITTER_EMAIL: 'builder@yclaw.ai',
    };

    // Pre-push secret scan — block if secrets detected
    const scanResult = prePushSecretScan(cwd);
    if (!scanResult.clean) {
      logger.error('BLOCKED: secrets detected in workspace, refusing to push', {
        workspace: workspace.id,
        findings: scanResult.findings.length,
      });
      return { pushed: false };
    }

    // Sanitize CLAUDE.md if it was updated by the CLI tool
    this.sanitizeClaudeMdOutput(workspace);

    // Stage all changes (respects .gitignore)
    await spawnCli({
      command: 'git', args: ['add', '-A'], cwd, env: gitEnv, timeout_ms: 30_000,
    });

    // Check if there are changes to commit
    const statusResult = await spawnCli({
      command: 'git', args: ['status', '--porcelain'], cwd, env: gitEnv, timeout_ms: 10_000,
    });

    if (!statusResult.stdout.trim()) {
      logger.info('No changes to commit', { workspace: workspace.id });
      return { pushed: false };
    }

    // Commit
    const commitResult = await spawnCli({
      command: 'git', args: ['commit', '-m', message], cwd, env: gitEnv, timeout_ms: 30_000,
    });

    if (commitResult.exit_code !== 0) {
      logger.error('Commit failed', { stderr: commitResult.stderr.slice(0, 500) });
      return { pushed: false };
    }

    // Get commit SHA
    const shaResult = await spawnCli({
      command: 'git', args: ['rev-parse', 'HEAD'], cwd, env: gitEnv, timeout_ms: 10_000,
    });
    const sha = shaResult.stdout.trim();

    // Push — credential helper in .git/config provides auth transparently
    const pushResult = await spawnCli({
      command: 'git',
      args: ['push', 'origin', workspace.branch],
      cwd,
      env: { ...gitEnv, GIT_TERMINAL_PROMPT: '0' },
      timeout_ms: 60_000,
    });

    if (pushResult.exit_code !== 0) {
      logger.error('Push failed', { stderr: pushResult.stderr.slice(0, 500) });
      return { sha, pushed: false };
    }

    logger.info('Committed and pushed', {
      workspace: workspace.id,
      branch: workspace.branch,
      sha,
    });

    return { sha, pushed: true };
  }

  /**
   * Get list of files changed in the workspace (vs default branch).
   */
  async getFilesChanged(workspace: Workspace): Promise<string[]> {
    const { github } = workspace.repoConfig;
    const result = await spawnCli({
      command: 'git',
      args: ['diff', '--name-only', `origin/${github.default_branch}...HEAD`],
      cwd: workspace.repoPath,
      env: {},
      timeout_ms: 10_000,
    });

    if (result.exit_code !== 0) return [];
    return result.stdout.trim().split('\n').filter(Boolean);
  }

  /**
   * Cleanup: remove the workspace directory.
   * Called in a try/finally to guarantee cleanup even on crash.
   */
  cleanup(workspace: Workspace): void {
    workspace.state = 'cleaning';
    try {
      if (existsSync(workspace.basePath)) {
        rmSync(workspace.basePath, { recursive: true, force: true });
        logger.info('Workspace cleaned up', { id: workspace.id });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('Workspace cleanup failed', { id: workspace.id, error: msg });
    }
  }

  /**
   * Sanitize the repo's canonical CLAUDE.md after CLI tool updates.
   * - Redacts any secrets that leaked into the file
   * - Caps file size (50KB)
   * - Strips raw stack traces and log dumps
   */
  private sanitizeClaudeMdOutput(workspace: Workspace): void {
    const claudeMdPath = join(
      workspace.repoPath,
      workspace.repoConfig.codegen.claude_md_path,
    );

    if (!existsSync(claudeMdPath)) return;

    const content = readFileSync(claudeMdPath, 'utf-8');
    const sanitized = sanitizeForClaudeMd(content);

    if (sanitized !== content) {
      writeFileSync(claudeMdPath, sanitized);
      logger.info('CLAUDE.md sanitized', {
        workspace: workspace.id,
        originalBytes: Buffer.byteLength(content, 'utf-8'),
        sanitizedBytes: Buffer.byteLength(sanitized, 'utf-8'),
      });
    }
  }

  /**
   * Redact secrets from log output before storage.
   * Used by the codegen executor when recording session logs.
   */
  static redactLogs(content: string): string {
    return redactSecrets(content);
  }

  /**
   * Garbage collection: remove stale workspaces older than 1 hour.
   */
  cleanupStaleWorkspaces(): number {
    if (!existsSync(WORKSPACES_BASE)) return 0;

    let cleaned = 0;
    const entries = readdirSync(WORKSPACES_BASE, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory() || !entry.name.startsWith('ws-')) continue;

      const dirPath = join(WORKSPACES_BASE, entry.name);
      try {
        const stat = statSync(dirPath);
        const age = Date.now() - stat.mtimeMs;
        if (age > STALE_WORKSPACE_MS) {
          rmSync(dirPath, { recursive: true, force: true });
          cleaned++;
          logger.info('Cleaned stale workspace', { dir: entry.name, age_ms: age });
        }
      } catch {
        // Ignore stat errors on concurrent cleanup
      }
    }

    return cleaned;
  }
}
