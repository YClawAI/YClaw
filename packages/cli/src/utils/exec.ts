/**
 * Child process helpers for running system commands.
 */

import { execFile } from 'node:child_process';

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Run a command and capture output. Does not throw on non-zero exit.
 */
export function run(
  cmd: string,
  args: string[] = [],
  timeoutMs: number = 10_000,
): Promise<ExecResult> {
  return new Promise((resolve) => {
    const proc = execFile(cmd, args, {
      timeout: timeoutMs,
      maxBuffer: 1024 * 1024,
    }, (err, stdout, stderr) => {
      resolve({
        stdout: stdout?.toString() ?? '',
        stderr: stderr?.toString() ?? '',
        exitCode: err ? (err as any).code ?? 1 : 0,
      });
    });
    proc.on('error', () => {
      resolve({ stdout: '', stderr: '', exitCode: 127 });
    });
  });
}

/**
 * Check if a command exists on the system PATH.
 */
export async function commandExists(cmd: string): Promise<boolean> {
  const result = await run('which', [cmd]);
  return result.exitCode === 0;
}
