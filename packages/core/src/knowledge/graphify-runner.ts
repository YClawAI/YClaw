/**
 * Graphify CLI wrapper service.
 *
 * Invokes the graphify CLI to build/update a structural knowledge graph
 * from the Obsidian vault. Supports incremental updates via SHA256 cache,
 * deterministic-only fallback, and budget enforcement.
 */

import { spawn } from 'node:child_process';
import { mkdir, access } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createLogger } from '../logging/logger.js';
import type { GraphifyConfig } from './graphify-types.js';

const logger = createLogger('graphify-runner');

/** Hard ceiling for a single graphify run (10 minutes). */
const MAX_TIMEOUT_MS = 10 * 60 * 1000;

/** Default exclusion patterns applied to vault content. */
const DEFAULT_EXCLUDES = ['05-inbox', '.obsidian', '.graphify', '.git', 'node_modules', '__pycache__'];

export interface GraphifyRunResult {
  status: 'success' | 'degraded' | 'failed';
  filesProcessed: number;
  cacheHits: number;
  degraded: boolean;
  duration: number;
  error?: string;
}

/**
 * Runs graphify CLI against the vault to build/update the knowledge graph.
 *
 * Always uses `--update` for incremental mode when a graph already exists.
 * Falls back to deterministic-only mode if the token budget is exceeded.
 * Never throws — returns a result with status indicating outcome.
 */
export async function runGraphify(config: GraphifyConfig): Promise<GraphifyRunResult> {
  const start = Date.now();

  const sourceRoot = resolve(config.source_root);
  const outputDir = resolve(config.output_dir);

  try {
    await mkdir(outputDir, { recursive: true });
    await mkdir(join(outputDir, '.cache'), { recursive: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('Failed to create graphify output directories', { error: msg });
    return { status: 'failed', filesProcessed: 0, cacheHits: 0, degraded: false, duration: Date.now() - start, error: msg };
  }

  const excludes = config.exclude ?? DEFAULT_EXCLUDES;
  const args = buildGraphifyArgs(sourceRoot, outputDir, excludes, config);

  logger.info('Running graphify', {
    sourceRoot,
    outputDir,
    incremental: config.incremental !== false,
    model: config.model,
  });

  const result = await spawnGraphify(args, sourceRoot, config);
  const duration = Date.now() - start;

  if (result.exit_code !== 0) {
    // If LLM-based extraction failed, try deterministic-only fallback
    if (!result.deterministicFallback) {
      logger.warn('Graphify failed, attempting deterministic-only fallback', {
        stderr: result.stderr.slice(0, 500),
      });
      const fallbackArgs = buildGraphifyArgs(sourceRoot, outputDir, excludes, config, true);
      const fallbackResult = await spawnGraphify(fallbackArgs, sourceRoot, config);
      const totalDuration = Date.now() - start;

      if (fallbackResult.exit_code === 0) {
        const parsed = parseGraphifyOutput(fallbackResult.stdout);
        return {
          status: 'degraded',
          filesProcessed: parsed.filesProcessed,
          cacheHits: parsed.cacheHits,
          degraded: true,
          duration: totalDuration,
        };
      }

      return {
        status: 'failed',
        filesProcessed: 0,
        cacheHits: 0,
        degraded: false,
        duration: totalDuration,
        error: fallbackResult.stderr.slice(0, 500),
      };
    }

    return {
      status: 'failed',
      filesProcessed: 0,
      cacheHits: 0,
      degraded: false,
      duration,
      error: result.stderr.slice(0, 500),
    };
  }

  const parsed = parseGraphifyOutput(result.stdout);
  return {
    status: 'success',
    filesProcessed: parsed.filesProcessed,
    cacheHits: parsed.cacheHits,
    degraded: false,
    duration,
  };
}

/**
 * Check whether graphify CLI is available.
 */
export async function isGraphifyAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn('graphify', ['--version'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 5_000,
    });
    child.on('close', (code) => resolve(code === 0));
    child.on('error', () => resolve(false));
  });
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function buildGraphifyArgs(
  sourceRoot: string,
  outputDir: string,
  excludes: string[],
  config: GraphifyConfig,
  deterministicOnly = false,
): string[] {
  const args: string[] = [sourceRoot, '-o', outputDir];

  // Incremental update mode
  if (config.incremental !== false) {
    args.push('--update');
  }

  // Exclusions
  for (const ex of excludes) {
    args.push('--exclude', ex);
  }

  // Cache directory
  args.push('--cache-dir', join(outputDir, '.cache'));

  // Model for LLM extraction
  if (!deterministicOnly && config.model) {
    args.push('--model', config.model);
  }

  // Token budget
  if (config.max_tokens_per_run) {
    args.push('--max-tokens', String(config.max_tokens_per_run));
  }

  // Deterministic-only mode (no LLM pass)
  if (deterministicOnly) {
    args.push('--deterministic-only');
  }

  // Output formats
  args.push('--json', '--html', '--report');

  return args;
}

interface SpawnResult {
  exit_code: number;
  stdout: string;
  stderr: string;
  deterministicFallback: boolean;
}

function spawnGraphify(
  args: string[],
  cwd: string,
  config: GraphifyConfig,
): Promise<SpawnResult> {
  const timeout = Math.min(config.timeout_ms ?? MAX_TIMEOUT_MS, MAX_TIMEOUT_MS);

  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const deterministicFallback = args.includes('--deterministic-only');

    const ac = new AbortController();
    const timer = setTimeout(() => {
      timedOut = true;
      ac.abort();
    }, timeout);

    const env: Record<string, string> = {
      PATH: process.env['PATH'] ?? '/usr/local/bin:/usr/bin:/bin',
      HOME: process.env['HOME'] ?? '/home/node',
    };

    // Pass API key if model needs it
    const apiKey = process.env['ANTHROPIC_API_KEY'];
    if (apiKey) {
      env['ANTHROPIC_API_KEY'] = apiKey;
    }

    const child = spawn('graphify', args, {
      cwd,
      env,
      signal: ac.signal,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) {
        logger.warn('Graphify process timed out', { timeout });
        stderr += '\nProcess timed out';
      }
      resolve({ exit_code: code ?? 1, stdout, stderr, deterministicFallback });
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ exit_code: 1, stdout, stderr: stderr + '\n' + err.message, deterministicFallback });
    });
  });
}

interface ParsedOutput {
  filesProcessed: number;
  cacheHits: number;
}

function parseGraphifyOutput(stdout: string): ParsedOutput {
  let filesProcessed = 0;
  let cacheHits = 0;

  // Graphify outputs structured summary lines
  const filesMatch = stdout.match(/files[_ ]processed:\s*(\d+)/i);
  if (filesMatch?.[1]) filesProcessed = parseInt(filesMatch[1], 10);

  const cacheMatch = stdout.match(/cache[_ ]hits:\s*(\d+)/i);
  if (cacheMatch?.[1]) cacheHits = parseInt(cacheMatch[1], 10);

  return { filesProcessed, cacheHits };
}
