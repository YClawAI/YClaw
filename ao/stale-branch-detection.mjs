/**
 * Stale branch conflict detection for AO session initialization.
 *
 * When AO is dispatched to work on an issue that already has a remote branch
 * (from a prior closed/abandoned PR), AO can silently fail if it encounters
 * the stale branch and cannot cleanly create or check out the expected ref.
 *
 * These utilities detect such conflicts *before* spawning a new AO session
 * and archive the stale branch so the new session can start clean.
 */

/**
 * Parse `git ls-remote --heads` stdout into an array of ref objects.
 *
 * @param {string} output - Raw stdout from `git ls-remote --heads origin <pattern>`
 * @returns {{ branch: string, sha: string }[]}
 */
export function parseLsRemoteRefs(output) {
  return output
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const tabIndex = line.indexOf('\t');
      if (tabIndex === -1) return null;
      const sha = line.slice(0, tabIndex).trim();
      const ref = line.slice(tabIndex + 1).trim();
      const branch = ref.startsWith('refs/heads/')
        ? ref.slice('refs/heads/'.length)
        : null;
      if (!sha || !branch) return null;
      return { sha, branch };
    })
    .filter(Boolean);
}

/**
 * Compute an available archive branch name for a stale branch.
 *
 * Tries "<staleBranch>-stale", then "<staleBranch>-stale-v2", "-v3", etc.
 * Falls back to a timestamp suffix if all candidate names are taken.
 *
 * @param {string} staleBranch - Original branch name (e.g. "feat/issue-144")
 * @param {string[]} existingBranches - Remote branches that already exist
 * @returns {string} - An available archive branch name
 */
export function computeArchiveBranchName(staleBranch, existingBranches) {
  const existing = new Set(existingBranches);
  const base = `${staleBranch}-stale`;
  if (!existing.has(base)) return base;
  for (let i = 2; i <= 20; i++) {
    const candidate = `${base}-v${i}`;
    if (!existing.has(candidate)) return candidate;
  }
  return `${base}-${Date.now()}`;
}

/**
 * Detect a stale remote branch for a given issue number.
 *
 * A branch is "stale" when:
 *   1. It exists on the remote and matches `*issue-<N>*`
 *   2. It has one or more commits NOT present in the default branch
 *      (i.e., it diverged from main — work that was never merged).
 *
 * @param {number} issueNumber
 * @param {string} cwd - Repo mirror working directory
 * @param {Function} runCmd
 *   A `runCommand`-compatible function:
 *   `(cmd: string, args: string[], cwd: string, timeoutMs: number) => Promise<{stdout: string}>`
 * @returns {Promise<{ branch: string, sha: string, aheadCount: number } | null>}
 *   Returns the first stale branch found, or null if none.
 */
export async function detectStaleBranchForIssue(issueNumber, cwd, runCmd) {
  // Resolve the default branch so we can measure divergence against it.
  let defaultBranch = 'main';
  try {
    const showResult = await runCmd('git', ['remote', 'show', 'origin'], cwd, 15000);
    const line = showResult.stdout.split('\n').find((l) => l.includes('HEAD branch:'));
    const detected = line?.split(':').pop()?.trim();
    if (detected) defaultBranch = detected;
  } catch {
    try {
      const cfgResult = await runCmd('git', ['config', 'init.defaultBranch'], cwd, 5000);
      if (cfgResult.stdout.trim()) defaultBranch = cfgResult.stdout.trim();
    } catch {
      // use 'main' fallback
    }
  }

  // Only check the primary issue pattern; the secondary `*-N-*` pattern
  // is too broad and would match unrelated branches like "fix-100-typo".
  const pattern = `*issue-${issueNumber}*`;

  let lsResult;
  try {
    lsResult = await runCmd('git', ['ls-remote', '--heads', 'origin', pattern], cwd, 15000);
  } catch {
    return null;
  }

  const refs = parseLsRemoteRefs(lsResult.stdout);
  if (refs.length === 0) return null;

  for (const { branch, sha } of refs) {
    // Fetch the branch locally so we can compare with origin/<defaultBranch>.
    try {
      await runCmd('git', ['fetch', 'origin', branch, '--depth=50', '--no-tags'], cwd, 60000);
    } catch {
      // Cannot fetch → cannot determine divergence → skip (fail-open).
      continue;
    }

    // Count commits on this branch that are not in the default branch.
    let aheadCount = 0;
    try {
      const revResult = await runCmd(
        'git',
        ['rev-list', '--count', `origin/${branch}`, '--not', `origin/${defaultBranch}`],
        cwd,
        15000,
      );
      aheadCount = parseInt(revResult.stdout.trim(), 10) || 0;
    } catch {
      // Cannot compare → skip (fail-open).
      continue;
    }

    if (aheadCount > 0) {
      return { branch, sha, aheadCount };
    }
  }

  return null;
}

/**
 * Archive a stale remote branch by pushing its commits to a new name,
 * then deleting the original.
 *
 * This clears the way for a fresh AO session to re-create the branch
 * without encountering checkout conflicts.
 *
 * @param {string} staleBranch - e.g. "feat/issue-144"
 * @param {string} staleSha - The branch's current HEAD SHA
 * @param {string} cwd - Repo mirror working directory
 * @param {Function} runCmd - `runCommand`-compatible function
 * @returns {Promise<string>} - The archive branch name that was created
 */
export async function archiveStaleBranch(staleBranch, staleSha, cwd, runCmd) {
  let existingBranches = [];
  try {
    const result = await runCmd('git', ['ls-remote', '--heads', 'origin'], cwd, 15000);
    existingBranches = parseLsRemoteRefs(result.stdout).map((r) => r.branch);
  } catch {
    // If we cannot list branches, computeArchiveBranchName will fall back to
    // a timestamp suffix, which is always unique.
  }

  const archiveBranch = computeArchiveBranchName(staleBranch, existingBranches);

  // Push the stale SHA to the archive branch name.
  await runCmd(
    'git',
    ['push', 'origin', `${staleSha}:refs/heads/${archiveBranch}`],
    cwd,
    30000,
  );

  // Remove the original stale branch so AO can create a clean one.
  await runCmd('git', ['push', 'origin', '--delete', staleBranch], cwd, 30000);

  return archiveBranch;
}
