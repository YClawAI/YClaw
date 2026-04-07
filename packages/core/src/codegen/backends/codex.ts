import type { CodegenBackend } from './types.js';
import type { BackendExecuteParams, BackendResult } from '../types.js';
import { spawnCli } from './spawn-cli.js';
import { createLogger } from '../../logging/logger.js';

const logger = createLogger('backend-codex');

// ─── Codex Backend ──────────────────────────────────────────────────────────
//
// Invokes OpenAI's `codex` CLI.
// Requires OPENAI_API_KEY in environment.
//

export class CodexBackend implements CodegenBackend {
  readonly name = 'codex';

  async execute(params: BackendExecuteParams): Promise<BackendResult> {
    const { workspace, task, timeout_ms, env } = params;

    logger.info('Executing Codex', {
      repo: workspace.repoConfig.name,
      task: task.slice(0, 100),
    });

    const result = await spawnCli({
      command: 'codex',
      args: ['exec', task],
      cwd: workspace.repoPath,
      env: {
        ...env,
        OPENAI_API_KEY: process.env.OPENAI_API_KEY || '',
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
    if (!process.env.OPENAI_API_KEY) {
      logger.warn('Codex unavailable: OPENAI_API_KEY not set');
      return false;
    }

    const result = await spawnCli({
      command: 'codex',
      args: ['--version'],
      cwd: '/tmp',
      env: {},
      timeout_ms: 10_000,
    });

    return result.exit_code === 0;
  }
}
