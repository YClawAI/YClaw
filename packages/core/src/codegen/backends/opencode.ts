import type { CodegenBackend } from './types.js';
import type { BackendExecuteParams, BackendResult } from '../types.js';
import { spawnCli } from './spawn-cli.js';
import { createLogger } from '../../logging/logger.js';

const logger = createLogger('backend-opencode');

// ─── OpenCode Backend (anomalyco/opencode) ─────────────────────────────────
//
// Invokes `opencode` CLI in non-interactive mode.
// https://github.com/anomalyco/opencode
//
// Provider-agnostic (BYOK) — uses provider/model syntax (e.g., "anthropic/claude-sonnet-4-5-20250929").
// On Fargate (no GPU), uses remote providers via API keys.
// Local model support via Ollama is a future path when GPU infra exists.
//
// Key flags:
//   opencode run <message..>     Non-interactive mode
//   --format json                Machine-readable JSON events output
//   --model provider/model       Override model selection
//

export class OpenCodeBackend implements CodegenBackend {
  readonly name = 'opencode';

  async execute(params: BackendExecuteParams): Promise<BackendResult> {
    const { workspace, task, timeout_ms, env } = params;

    logger.info('Executing opencode', {
      repo: workspace.repoConfig.name,
      task: task.slice(0, 100),
    });

    const result = await spawnCli({
      command: 'opencode',
      args: ['run', '--format', 'json', task],
      cwd: workspace.repoPath,
      env: {
        ...env,
        // opencode is BYOK — pass through whatever provider keys are available
        // Uses provider/model syntax, authenticates via standard env vars
        ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || '',
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
    const result = await spawnCli({
      command: 'opencode',
      args: ['--version'],
      cwd: '/tmp',
      env: {},
      timeout_ms: 10_000,
    });

    return result.exit_code === 0;
  }
}
