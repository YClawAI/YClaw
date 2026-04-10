import { Octokit } from '@octokit/rest';
import { createLogger } from '../logging/logger.js';
import { getGitHubToken } from './github/app-auth.js';
import type { ActionResult } from './types.js';
import type { ToolDefinition } from '../config/schema.js';

const logger = createLogger('github-compare');

// ─── GitHub Compare Commits ─────────────────────────────────────────────────
//
// Calls the GitHub Compare API to get the list of changed files between two refs.
// Used by the Deployer to determine if a commit is docs-only before convening
// the deploy council.
//
// GitHub API: GET /repos/{owner}/{repo}/compare/{basehead}
// Docs: https://docs.github.com/en/rest/commits/commits#compare-two-commits
//

export interface CompareCommitsParams {
  owner?: string;
  repo?: string;
  base: string;
  head: string;
}

export interface CompareCommitsResult {
  files: Array<{
    filename: string;
    status: string;
    additions: number;
    deletions: number;
  }>;
  total_commits: number;
  ahead_by: number;
}

/**
 * Create an Octokit instance using the shared GitHub auth provider.
 * Convenience factory for callers that don't have an Octokit instance handy.
 */
export async function createAuthenticatedOctokit(): Promise<Octokit> {
  const token = await getGitHubToken();
  return new Octokit({ auth: token });
}

/**
 * Compare two commits and return the list of changed files.
 */
export async function compareCommits(
  octokit: Octokit,
  params: CompareCommitsParams,
): Promise<ActionResult> {
  const owner = params.owner ?? 'yclaw-ai';
  const repo = params.repo ?? 'yclaw';
  const { base, head } = params;

  if (!base || !head) {
    return {
      success: false,
      error: 'Both "base" and "head" parameters are required for compare_commits',
    };
  }

  logger.info(`Comparing commits: ${owner}/${repo} ${base}...${head}`);

  try {
    const response = await octokit.repos.compareCommits({
      owner,
      repo,
      base,
      head,
    });

    const files = (response.data.files ?? []).map((f: { filename: string; status?: string; additions: number; deletions: number }) => ({
      filename: f.filename,
      status: f.status ?? 'unknown',
      additions: f.additions,
      deletions: f.deletions,
    }));

    const result: CompareCommitsResult = {
      files,
      total_commits: response.data.total_commits,
      ahead_by: response.data.ahead_by,
    };

    logger.info(
      `Compare result: ${files.length} files changed, ${result.total_commits} commits`,
    );

    return {
      success: true,
      data: result as unknown as Record<string, unknown>,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    logger.error(`Failed to compare commits: ${message}`, { stack });
    return {
      success: false,
      error: `Failed to compare commits ${base}...${head}: ${message}`,
    };
  }
}

/**
 * Tool definition for github:compare_commits.
 * Add this to the GitHubExecutor's getToolDefinitions() array.
 */
export const compareCommitsToolDefinition: ToolDefinition = {
  name: 'github_compare_commits',
  description:
    'Compare two commits in a GitHub repository and return the list of changed files with their status (added/modified/removed), additions, and deletions. Useful for determining what changed in a deployment.',
  parameters: {
    owner: {
      type: 'string',
      description: 'Repository owner (default: yclaw-ai)',
      required: false,
    },
    repo: {
      type: 'string',
      description: 'Repository name (default: yclaw)',
      required: false,
    },
    base: {
      type: 'string',
      description:
        'Base ref (branch, tag, or SHA) — the starting point of the comparison',
      required: true,
    },
    head: {
      type: 'string',
      description:
        'Head ref (branch, tag, or SHA) — the ending point of the comparison',
      required: true,
    },
  },
};
