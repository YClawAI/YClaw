/**
 * Workspace boundary enforcement for YClaw-safe tools.
 *
 * Every tool call that touches the filesystem MUST validate
 * the resolved path against the workspace root before proceeding.
 */

import { resolve, normalize } from 'node:path';
import { realpath } from 'node:fs/promises';
import { realpathSync } from 'node:fs';

/**
 * Resolve a user-provided path against the workspace root and verify
 * it stays within the boundary.
 *
 * Returns the resolved absolute path, or throws if the path escapes.
 *
 * Handles:
 *   - Relative paths (../../../etc/passwd)
 *   - Absolute paths (/etc/passwd)
 *   - Normalized traversal (foo/../../bar)
 */
export function resolveWithinWorkspace(workspaceRoot: string, userPath: string): string {
  // Normalize workspace root to remove trailing slashes.
  // Use realpathSync to handle platform symlinks (e.g., macOS /var → /private/var).
  let root: string;
  try {
    root = realpathSync(normalize(workspaceRoot));
  } catch {
    root = normalize(workspaceRoot);
  }

  // If the path is absolute, check it directly; if relative, resolve against root
  const resolved = resolve(root, userPath);

  // The resolved path must be the root itself or a child of it
  if (resolved !== root && !resolved.startsWith(root + '/')) {
    throw new WorkspaceBoundaryError(userPath, root);
  }

  return resolved;
}

/**
 * Resolve path AND follow symlinks to ensure the real target is also
 * within the workspace. Prevents symlink escape attacks.
 *
 * Falls back to resolveWithinWorkspace if the file doesn't exist yet
 * (e.g., for write operations creating new files).
 */
export async function resolveWithinWorkspaceReal(
  workspaceRoot: string,
  userPath: string,
): Promise<string> {
  // First pass: check the normalized path
  const resolved = resolveWithinWorkspace(workspaceRoot, userPath);

  // Second pass: resolve symlinks
  try {
    const real = await realpath(resolved);
    const root = normalize(workspaceRoot);
    if (real !== root && !real.startsWith(root + '/')) {
      throw new WorkspaceBoundaryError(userPath, root);
    }
    return real;
  } catch (err) {
    // ENOENT is expected for new files — the normalized check is sufficient
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return resolved;
    }
    if (err instanceof WorkspaceBoundaryError) {
      throw err;
    }
    throw err;
  }
}

export class WorkspaceBoundaryError extends Error {
  constructor(
    public readonly attemptedPath: string,
    public readonly workspaceRoot: string,
  ) {
    super(`Path outside workspace: "${attemptedPath}" escapes "${workspaceRoot}"`);
    this.name = 'WorkspaceBoundaryError';
  }
}
