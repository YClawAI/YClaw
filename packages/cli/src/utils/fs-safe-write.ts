/**
 * Safe file writing — checks if file exists, aborts unless --force.
 */

import { writeFile, access, mkdir, chmod } from 'node:fs/promises';
import { dirname } from 'node:path';
import { CliError } from './errors.js';

/**
 * Write content to a file. If the file already exists and force is false,
 * throws a CliError telling the user to use --force.
 *
 * @param secretFile - If true, writes with 0o600 permissions (owner-only).
 */
export async function safeWrite(
  filePath: string,
  content: string,
  force: boolean = false,
  secretFile: boolean = false,
): Promise<void> {
  if (!force) {
    try {
      await access(filePath);
      throw new CliError(
        `File already exists: ${filePath}`,
        'Overwriting existing files requires explicit confirmation',
        `Run with --force to overwrite, or delete ${filePath} first`,
      );
    } catch (err: unknown) {
      if (err instanceof CliError) throw err;
      // Only ignore ENOENT (file not found) — re-throw other errors
      if (err && typeof err === 'object' && 'code' in err
        && (err as { code: string }).code !== 'ENOENT') {
        throw err;
      }
    }
  }

  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, content, 'utf-8');

  // .env files contain secrets — restrict permissions (Gemini)
  if (secretFile) {
    try {
      await chmod(filePath, 0o600);
    } catch {
      // chmod may fail on Windows — non-fatal
    }
  }
}
