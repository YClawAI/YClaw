import { describe, expect, it } from 'vitest';
import {
  parseLsRemoteRefs,
  computeArchiveBranchName,
  detectStaleBranchForIssue,
  archiveStaleBranch,
} from './stale-branch-detection.mjs';

// ── parseLsRemoteRefs ─────────────────────────────────────────────────────────

describe('parseLsRemoteRefs', () => {
  it('parses a single ref line', () => {
    const output = 'abc123\trefs/heads/feat/issue-144\n';
    const refs = parseLsRemoteRefs(output);
    expect(refs).toHaveLength(1);
    expect(refs[0]).toEqual({ sha: 'abc123', branch: 'feat/issue-144' });
  });

  it('parses multiple ref lines', () => {
    const output = [
      'abc123\trefs/heads/feat/issue-144',
      'def456\trefs/heads/feat/issue-144-fix',
    ].join('\n');
    const refs = parseLsRemoteRefs(output);
    expect(refs).toHaveLength(2);
    expect(refs[0].branch).toBe('feat/issue-144');
    expect(refs[1].branch).toBe('feat/issue-144-fix');
  });

  it('returns empty array for empty output', () => {
    expect(parseLsRemoteRefs('')).toEqual([]);
    expect(parseLsRemoteRefs('\n\n')).toEqual([]);
  });

  it('skips malformed lines without a tab', () => {
    const output = 'abc123 refs/heads/feat/issue-144\ngood\trefs/heads/main';
    const refs = parseLsRemoteRefs(output);
    // First line has no tab → skipped; second line has tab but "good" is not a valid ref path
    // Actually "main" is valid
    expect(refs.some((r) => r.branch === 'main')).toBe(true);
    // The space-separated line is skipped
    expect(refs.every((r) => r.branch !== 'feat/issue-144')).toBe(true);
  });

  it('strips refs/heads/ prefix', () => {
    const output = 'abc123\trefs/heads/fix/issue-179-stale-branch\n';
    const refs = parseLsRemoteRefs(output);
    expect(refs[0].branch).toBe('fix/issue-179-stale-branch');
  });

  it('ignores non-heads refs (tags, etc.)', () => {
    const output = 'abc123\trefs/tags/v1.0.0\n';
    const refs = parseLsRemoteRefs(output);
    // ref doesn't start with refs/heads/ → branch is null → filtered out
    expect(refs).toHaveLength(0);
  });
});

// ── computeArchiveBranchName ──────────────────────────────────────────────────

describe('computeArchiveBranchName', () => {
  it('returns <branch>-stale when it does not exist', () => {
    const result = computeArchiveBranchName('feat/issue-144', []);
    expect(result).toBe('feat/issue-144-stale');
  });

  it('appends -v2 when -stale is taken', () => {
    const result = computeArchiveBranchName('feat/issue-144', ['feat/issue-144-stale']);
    expect(result).toBe('feat/issue-144-stale-v2');
  });

  it('increments suffix until an unused name is found', () => {
    const existing = [
      'feat/issue-144-stale',
      'feat/issue-144-stale-v2',
      'feat/issue-144-stale-v3',
    ];
    const result = computeArchiveBranchName('feat/issue-144', existing);
    expect(result).toBe('feat/issue-144-stale-v4');
  });

  it('uses timestamp fallback after 20 suffixes', () => {
    const existing = ['feat/issue-144-stale'];
    for (let i = 2; i <= 20; i++) {
      existing.push(`feat/issue-144-stale-v${i}`);
    }
    const result = computeArchiveBranchName('feat/issue-144', existing);
    expect(result).toMatch(/^feat\/issue-144-stale-\d+$/);
  });
});

// ── detectStaleBranchForIssue ─────────────────────────────────────────────────

describe('detectStaleBranchForIssue', () => {
  function makeRunCmd(responses) {
    return async (cmd, args) => {
      const key = [cmd, ...args].join(' ');
      // Find matching response by prefix
      for (const [pattern, response] of Object.entries(responses)) {
        if (key.startsWith(pattern) || key.includes(pattern)) {
          if (response instanceof Error) throw response;
          return { stdout: response };
        }
      }
      return { stdout: '' };
    };
  }

  it('returns null when no remote branch matches the issue', async () => {
    const runCmd = makeRunCmd({
      'git remote show origin': 'HEAD branch: main',
      'git ls-remote --heads origin *issue-144*': '',
    });
    const result = await detectStaleBranchForIssue(144, '/repo', runCmd);
    expect(result).toBeNull();
  });

  it('returns null when the matching branch is fully merged', async () => {
    const runCmd = makeRunCmd({
      'git remote show origin': 'HEAD branch: main',
      'git ls-remote --heads origin *issue-144*': 'abc123\trefs/heads/feat/issue-144\n',
      'git fetch origin feat/issue-144': '',
      'git rev-list --count origin/feat/issue-144 --not origin/main': '0',
    });
    const result = await detectStaleBranchForIssue(144, '/repo', runCmd);
    expect(result).toBeNull();
  });

  it('returns conflict info when the branch has unmerged commits', async () => {
    const runCmd = makeRunCmd({
      'git remote show origin': 'HEAD branch: main',
      'git ls-remote --heads origin *issue-144*': 'abc123\trefs/heads/feat/issue-144\n',
      'git fetch origin feat/issue-144': '',
      'git rev-list --count origin/feat/issue-144 --not origin/main': '3',
    });
    const result = await detectStaleBranchForIssue(144, '/repo', runCmd);
    expect(result).toEqual({ branch: 'feat/issue-144', sha: 'abc123', aheadCount: 3 });
  });

  it('returns first stale match when multiple branches exist', async () => {
    // Both branches match but only the first is checked (sequential)
    const calls = [];
    const runCmd = async (cmd, args) => {
      const key = [cmd, ...args].join(' ');
      calls.push(key);
      if (key.includes('remote show origin')) return { stdout: 'HEAD branch: main' };
      if (key.includes('ls-remote --heads origin *issue-200*')) {
        return {
          stdout: [
            'sha1\trefs/heads/feat/issue-200',
            'sha2\trefs/heads/fix/issue-200-attempt2',
          ].join('\n'),
        };
      }
      if (key.includes('fetch origin feat/issue-200')) return { stdout: '' };
      if (key.includes('rev-list --count origin/feat/issue-200 --not origin/main')) {
        return { stdout: '5' };
      }
      return { stdout: '0' };
    };
    const result = await detectStaleBranchForIssue(200, '/repo', runCmd);
    expect(result).not.toBeNull();
    expect(result.branch).toBe('feat/issue-200');
    expect(result.aheadCount).toBe(5);
  });

  it('skips branch and continues when fetch fails', async () => {
    const runCmd = makeRunCmd({
      'git remote show origin': 'HEAD branch: main',
      'git ls-remote --heads origin *issue-99*': 'abc\trefs/heads/feat/issue-99\n',
      'git fetch origin feat/issue-99': new Error('fetch failed'),
    });
    const result = await detectStaleBranchForIssue(99, '/repo', runCmd);
    expect(result).toBeNull();
  });

  it('returns null when ls-remote throws', async () => {
    const runCmd = async (cmd, args) => {
      const key = [cmd, ...args].join(' ');
      if (key.includes('remote show')) return { stdout: 'HEAD branch: main' };
      if (key.includes('ls-remote')) throw new Error('network error');
      return { stdout: '' };
    };
    const result = await detectStaleBranchForIssue(50, '/repo', runCmd);
    expect(result).toBeNull();
  });

  it('falls back to "main" when default branch detection fails', async () => {
    let revListArg = null;
    const runCmd = async (cmd, args) => {
      const key = [cmd, ...args].join(' ');
      if (key.includes('remote show')) throw new Error('no remote');
      if (key.includes('config init.defaultBranch')) throw new Error('no config');
      if (key.includes('ls-remote --heads origin *issue-7*')) {
        return { stdout: 'deadbeef\trefs/heads/feat/issue-7\n' };
      }
      if (key.includes('fetch')) return { stdout: '' };
      if (key.includes('rev-list --count origin/feat/issue-7 --not origin/main')) {
        revListArg = key;
        return { stdout: '2' };
      }
      return { stdout: '0' };
    };
    const result = await detectStaleBranchForIssue(7, '/repo', runCmd);
    expect(result).not.toBeNull();
    expect(result.branch).toBe('feat/issue-7');
    // Verify we compared against "main" (the fallback)
    expect(revListArg).toContain('origin/main');
  });
});

// ── archiveStaleBranch ────────────────────────────────────────────────────────

describe('archiveStaleBranch', () => {
  it('pushes to archive branch and deletes original', async () => {
    const commands = [];
    const runCmd = async (cmd, args) => {
      commands.push([cmd, ...args].join(' '));
      if ([cmd, ...args].join(' ').includes('ls-remote --heads origin')) {
        return { stdout: '' };
      }
      return { stdout: '' };
    };

    const archiveName = await archiveStaleBranch(
      'feat/issue-144',
      'abc123sha',
      '/repo',
      runCmd,
    );

    expect(archiveName).toBe('feat/issue-144-stale');
    expect(commands.some((c) => c.includes('abc123sha:refs/heads/feat/issue-144-stale'))).toBe(true);
    expect(commands.some((c) => c.includes('--delete') && c.includes('feat/issue-144'))).toBe(true);
  });

  it('uses next available archive name when -stale already exists', async () => {
    const runCmd = async (cmd, args) => {
      const key = [cmd, ...args].join(' ');
      if (key.includes('ls-remote --heads origin') && !key.includes('--heads origin *')) {
        return { stdout: 'x\trefs/heads/feat/issue-144-stale\n' };
      }
      return { stdout: '' };
    };

    const archiveName = await archiveStaleBranch(
      'feat/issue-144',
      'abc123sha',
      '/repo',
      runCmd,
    );
    expect(archiveName).toBe('feat/issue-144-stale-v2');
  });

  it('throws when the push to archive branch fails', async () => {
    const runCmd = async (cmd, args) => {
      const key = [cmd, ...args].join(' ');
      if (key.includes('ls-remote')) return { stdout: '' };
      if (key.includes('push') && key.includes('refs/heads')) {
        throw new Error('push rejected');
      }
      return { stdout: '' };
    };

    await expect(
      archiveStaleBranch('feat/issue-144', 'abc', '/repo', runCmd),
    ).rejects.toThrow('push rejected');
  });

  it('throws when the delete of the original branch fails', async () => {
    const runCmd = async (cmd, args) => {
      const key = [cmd, ...args].join(' ');
      if (key.includes('ls-remote')) return { stdout: '' };
      if (key.includes('push') && key.includes('refs/heads')) return { stdout: '' };
      if (key.includes('--delete')) throw new Error('delete failed');
      return { stdout: '' };
    };

    await expect(
      archiveStaleBranch('feat/issue-144', 'abc', '/repo', runCmd),
    ).rejects.toThrow('delete failed');
  });
});
