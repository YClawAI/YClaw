import type { CodegenBackend } from './types.js';
import type { BackendExecuteParams, BackendResult } from '../types.js';
import { spawnCli } from './spawn-cli.js';
import { createLogger } from '../../logging/logger.js';

const logger = createLogger('backend-claude');

// ─── Claude Code Backend ────────────────────────────────────────────────────
//
// Invokes `claude` CLI in non-interactive mode.
// Requires ANTHROPIC_API_KEY in environment.
//

export class ClaudeCodeBackend implements CodegenBackend {
  readonly name = 'claude';

  async execute(params: BackendExecuteParams): Promise<BackendResult> {
    const { workspace, task, timeout_ms, env } = params;

    logger.info('Executing Claude Code', {
      repo: workspace.repoConfig.name,
      task: task.slice(0, 100),
    });

    const result = await spawnCli({
      command: 'claude',
      args: [
        '-p', task,
        '--output-format', 'json',
        '--max-turns', '25',
      ],
      cwd: workspace.repoPath,
      env: {
        ...env,
        ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || '',
      },
      timeout_ms,
    });

    return {
      exit_code: result.exit_code,
      stdout: result.stdout,
      stderr: result.stderr,
      duration_ms: result.duration_ms,
      timed_out: result.timed_out,
    };
  }

  async isAvailable(): Promise<boolean> {
    if (!process.env.ANTHROPIC_API_KEY) {
      logger.warn('Claude Code unavailable: ANTHROPIC_API_KEY not set');
      return false;
    }

    const result = await spawnCli({
      command: 'claude',
      args: ['--version'],
      cwd: '/tmp',
      env: {},
      timeout_ms: 10_000,
    });

    return result.exit_code === 0;
  }
}
