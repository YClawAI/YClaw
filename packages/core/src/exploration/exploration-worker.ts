import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { tmpdir } from 'node:os';
import { createLogger } from '../logging/logger.js';
import { createProvider } from '../llm/provider.js';
import type { LLMMessage, LLMResponse } from '../llm/types.js';
import { AgentHubClient } from '../agenthub/client.js';
import type { ExplorationWorkerResult } from '../agenthub/types.js';

// ─── Constants ─────────────────────────────────────────────────────────────

const DEFAULT_MAX_ITERATIONS = 3;

const SYSTEM_PROMPT = `You are a coding agent participating in an exploration task.
You will receive a task description, context, and existing code.
Your goal: generate a high-quality solution.

Rules:
- Write clean, idiomatic TypeScript/JavaScript code.
- Include comments where logic is non-obvious.
- Do NOT modify TASK.md or CONTEXT.md — those are read-only scaffold files.
- Focus on correctness, architecture, and readability.
- Your solution will be compared against competing approaches from other workers.
- All file paths MUST be relative (e.g. "src/foo.ts"), never absolute or using "..".

Respond ONLY with the files to create/modify in this JSON format:
\`\`\`json
{
  "approach": "Brief one-line description of your approach",
  "files": {
    "relative/path/to/file.ts": "file content here",
    "another/file.ts": "content"
  }
}
\`\`\``;

// ─── ExplorationWorker ─────────────────────────────────────────────────────

/**
 * Generates code and pushes to AgentHub DAG.
 *
 * STANDALONE worker — does NOT extend or import CodingWorker.
 * Uses its own LLM integration for code generation.
 */
export class ExplorationWorker {
  private readonly log = createLogger('exploration-worker');

  constructor(
    private readonly agentHub: AgentHubClient,
    private readonly workerId: string,
  ) {}

  async explore(task: {
    taskId: string;
    parentHash: string;
    description: string;
    context: string;
    maxIterations?: number;
  }): Promise<ExplorationWorkerResult> {
    const maxIterations = task.maxIterations ?? DEFAULT_MAX_ITERATIONS;
    const tmpDir = mkdtempSync(join(tmpdir(), `exploration-${task.taskId}-${this.workerId}-`));

    try {
      const repoDir = join(tmpDir, 'work');
      mkdirSync(repoDir);
      git(repoDir, 'init');
      git(repoDir, 'config', 'user.email', `${this.workerId}@yclaw.ai`);
      git(repoDir, 'config', 'user.name', this.workerId);

      const bundlePath = join(tmpDir, 'parent.bundle');
      await this.agentHub.fetchCommit(task.parentHash, bundlePath);
      AgentHubClient.unbundle(repoDir, bundlePath);
      git(repoDir, 'checkout', task.parentHash);

      const taskMd = safeReadFile(join(repoDir, 'TASK.md'));
      const contextMd = safeReadFile(join(repoDir, 'CONTEXT.md'));

      let currentHash = task.parentHash;
      let lastMessage = '';
      let completedIterations = 0;

      for (let iteration = 1; iteration <= maxIterations; iteration++) {
        this.log.info('Starting iteration', {
          workerId: this.workerId,
          taskId: task.taskId,
          iteration,
          parentHash: currentHash.slice(0, 7),
        });

        const existingFiles = readRepoFiles(repoDir);
        const prompt = buildPrompt(task.description, taskMd, contextMd, existingFiles, iteration);
        const llmResult = await this.callLLM(prompt);

        const parsed = parseResponse(llmResult.content);
        if (!parsed) {
          this.log.warn('Failed to parse LLM response', {
            workerId: this.workerId,
            iteration,
            contentLength: llmResult.content.length,
          });
          break;
        }

        const { approach, files } = parsed;

        // F11: Validate and write files with path containment checks
        let filesWritten = 0;
        for (const [relPath, content] of Object.entries(files)) {
          if (!isSafePath(relPath, repoDir)) {
            this.log.warn('Rejected unsafe file path from LLM', {
              workerId: this.workerId,
              path: relPath,
            });
            continue;
          }

          const filePath = join(repoDir, relPath);
          const dir = join(filePath, '..');
          if (!existsSync(dir)) {
            execFileSync('mkdir', ['-p', dir]);
          }
          writeFileSync(filePath, content);
          filesWritten++;
        }

        if (filesWritten === 0) {
          this.log.info('No valid files to write', { workerId: this.workerId, iteration });
          break;
        }

        git(repoDir, 'add', '-A');

        const commitMessage = `${this.workerId}: ${approach} (iteration ${iteration})`;
        try {
          git(repoDir, 'commit', '-m', commitMessage);
        } catch {
          this.log.info('Nothing to commit', { workerId: this.workerId, iteration });
          break;
        }

        const iterBundlePath = join(tmpDir, `iter-${iteration}.bundle`);
        AgentHubClient.createBundle(repoDir, iterBundlePath, 'HEAD');
        const pushResult = await this.agentHub.pushBundle(iterBundlePath);

        if (pushResult.hashes.length === 0) {
          this.log.warn('Push returned no hashes', { workerId: this.workerId, iteration });
          break;
        }

        currentHash = pushResult.hashes[pushResult.hashes.length - 1]!;
        lastMessage = approach;
        completedIterations = iteration;

        await this.agentHub.createPost(
          'build-decisions',
          `**${this.workerId}** pushed \`${currentHash.slice(0, 7)}\` (child of \`${task.parentHash.slice(0, 7)}\`)\n` +
          `**Iteration:** ${iteration}/${maxIterations}\n` +
          `**Approach:** ${approach}\n` +
          `**Files:** ${filesWritten} changed`,
        ).catch((err) => {
          this.log.warn('Failed to post progress', { error: (err as Error).message });
        });

        this.log.info('Iteration complete', {
          workerId: this.workerId,
          iteration,
          hash: currentHash.slice(0, 7),
          approach,
          filesWritten,
        });
      }

      return {
        workerId: this.workerId,
        finalHash: currentHash,
        message: lastMessage || 'no changes',
        iterations: completedIterations,
      };
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  }

  private async callLLM(userPrompt: string): Promise<LLMResponse> {
    const provider = createProvider({
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      temperature: 0.3,
      maxTokens: 8192,
    });

    const messages: LLMMessage[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ];

    return provider.chat(messages, {
      model: 'claude-sonnet-4-6',
      temperature: 0.3,
      maxTokens: 8192,
    });
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

function safeReadFile(path: string): string {
  try {
    return readFileSync(path, 'utf-8');
  } catch {
    return '';
  }
}

/**
 * F11: Validate that a path from LLM response is safe.
 * Rejects absolute paths and paths that escape the workspace via `..`.
 */
function isSafePath(relPath: string, repoDir: string): boolean {
  if (isAbsolute(relPath)) return false;
  if (relPath.includes('..')) return false;
  // Double-check resolved path stays within repoDir
  const resolved = resolve(repoDir, relPath);
  const rel = relative(repoDir, resolved);
  if (rel.startsWith('..') || isAbsolute(rel)) return false;
  return true;
}

function readRepoFiles(dir: string, prefix = ''): Record<string, string> {
  const result: Record<string, string> = {};
  const SKIP = new Set(['.git', 'TASK.md', 'CONTEXT.md', 'node_modules']);

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      Object.assign(result, readRepoFiles(full, rel));
    } else {
      try {
        result[rel] = readFileSync(full, 'utf-8');
      } catch {
        // skip unreadable files
      }
    }
  }
  return result;
}

function buildPrompt(
  description: string,
  taskMd: string,
  contextMd: string,
  existingFiles: Record<string, string>,
  iteration: number,
): string {
  let prompt = `## Task\n${description}\n\n`;

  if (taskMd) {
    prompt += `## TASK.md\n${taskMd}\n\n`;
  }
  if (contextMd) {
    prompt += `## CONTEXT.md\n${contextMd}\n\n`;
  }

  const fileEntries = Object.entries(existingFiles);
  if (fileEntries.length > 0) {
    prompt += `## Existing Files\n`;
    for (const [path, content] of fileEntries) {
      // Truncate large files to avoid context overflow
      const truncated = content.length > 4000
        ? content.slice(0, 4000) + '\n... (truncated)'
        : content;
      prompt += `### ${path}\n\`\`\`\n${truncated}\n\`\`\`\n\n`;
    }
  }

  if (iteration > 1) {
    prompt += `## Refinement Round ${iteration}\n` +
      `Review your previous implementation above and improve it. ` +
      `Focus on correctness, edge cases, and code quality.\n\n`;
  }

  prompt += `Generate your solution now.`;
  return prompt;
}

function parseResponse(content: string): { approach: string; files: Record<string, string> } | null {
  const fenceMatch = content.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  const jsonStr = fenceMatch ? fenceMatch[1]! : content;

  try {
    const parsed = JSON.parse(jsonStr) as { approach?: string; files?: Record<string, string> };
    if (!parsed.files || typeof parsed.files !== 'object') return null;
    return {
      approach: parsed.approach ?? 'unspecified approach',
      files: parsed.files,
    };
  } catch {
    return null;
  }
}
