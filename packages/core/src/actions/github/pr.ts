import type { ActionResult } from '../types.js';
import type { ToolDefinition } from '../../config/schema.js';
import { GITHUB_API_BASE, GITHUB_DEFAULTS, type GitHubClient, logger } from './client.js';

// ─── Tool Definitions ────────────────────────────────────────────────────────

export const PR_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'github:create_pr',
    description: 'Create a pull request',
    parameters: {
      owner: { type: 'string', description: `Repository owner (default: ${GITHUB_DEFAULTS.owner})` },
      repo: { type: 'string', description: `Repository name (default: ${GITHUB_DEFAULTS.repo})` },
      title: { type: 'string', description: 'PR title', required: true },
      body: { type: 'string', description: 'PR description (markdown)' },
      head: { type: 'string', description: 'Source branch (the branch with changes)', required: true },
      base: { type: 'string', description: 'Target branch to merge into (default: master)' },
      closes_issues: { type: 'array', items: { type: 'number', description: 'GitHub issue number' }, description: 'Issue numbers this PR fixes. Auto-appends "Closes #NNN" to body for GitHub auto-close.' },
    },
  },
  {
    name: 'github:merge_pr',
    description: 'Merge a pull request',
    parameters: {
      owner: { type: 'string', description: `Repository owner (default: ${GITHUB_DEFAULTS.owner})` },
      repo: { type: 'string', description: `Repository name (default: ${GITHUB_DEFAULTS.repo})` },
      pullNumber: { type: 'number', description: 'Pull request number', required: true },
      commit_title: { type: 'string', description: 'Custom merge commit title' },
      merge_method: { type: 'string', description: 'Merge method: merge, squash, or rebase (default: squash)' },
    },
  },
  {
    name: 'github:enable_pr_auto_merge',
    description: 'Enable GitHub native auto-merge for an existing pull request',
    parameters: {
      owner: { type: 'string', description: `Repository owner (default: ${GITHUB_DEFAULTS.owner})` },
      repo: { type: 'string', description: `Repository name (default: ${GITHUB_DEFAULTS.repo})` },
      pullNumber: { type: 'number', description: 'Pull request number', required: true },
      merge_method: { type: 'string', description: 'Merge method: merge, squash, or rebase (default: squash)' },
    },
  },
  {
    name: 'github:update_pr_branch',
    description: 'Update a pull request branch with the latest base branch changes',
    parameters: {
      owner: { type: 'string', description: `Repository owner (default: ${GITHUB_DEFAULTS.owner})` },
      repo: { type: 'string', description: `Repository name (default: ${GITHUB_DEFAULTS.repo})` },
      pullNumber: { type: 'number', description: 'Pull request number', required: true },
      expected_head_sha: { type: 'string', description: 'Optional expected head SHA for optimistic locking' },
    },
  },
  {
    name: 'github:pr_review',
    description: 'Submit a review on a pull request (approve, request changes, or comment)',
    parameters: {
      owner: { type: 'string', description: `Repository owner (default: ${GITHUB_DEFAULTS.owner})` },
      repo: { type: 'string', description: `Repository name (default: ${GITHUB_DEFAULTS.repo})` },
      pullNumber: { type: 'number', description: 'Pull request number', required: true },
      event: { type: 'string', description: 'Review action: APPROVE, REQUEST_CHANGES, or COMMENT', required: true },
      body: { type: 'string', description: 'Review body text (required for REQUEST_CHANGES)' },
    },
  },
  {
    name: 'github:pr_comment',
    description: 'Add a comment on a pull request',
    parameters: {
      owner: { type: 'string', description: `Repository owner (default: ${GITHUB_DEFAULTS.owner})` },
      repo: { type: 'string', description: `Repository name (default: ${GITHUB_DEFAULTS.repo})` },
      pullNumber: { type: 'number', description: 'Pull request number', required: true },
      body: { type: 'string', description: 'Comment body (markdown)', required: true },
    },
  },
  {
    name: 'github:get_diff',
    description: 'Get the diff of a pull request for code review',
    parameters: {
      owner: { type: 'string', description: `Repository owner (default: ${GITHUB_DEFAULTS.owner})` },
      repo: { type: 'string', description: `Repository name (default: ${GITHUB_DEFAULTS.repo})` },
      pullNumber: { type: 'number', description: 'Pull request number', required: true },
    },
  },
  {
    name: 'github:get_pr',
    description: 'Get a pull request including mergeable status, conflict state, and metadata.',
    parameters: {
      owner: { type: 'string', description: `Repository owner (default: ${GITHUB_DEFAULTS.owner})` },
      repo: { type: 'string', description: `Repository name (default: ${GITHUB_DEFAULTS.repo})` },
      pullNumber: { type: 'number', description: 'Pull request number', required: true },
    },
  },
  {
    name: 'github:list_prs',
    description: 'List pull requests in a repository with optional filters',
    parameters: {
      owner: { type: 'string', description: `Repository owner (default: ${GITHUB_DEFAULTS.owner})` },
      repo: { type: 'string', description: `Repository name (default: ${GITHUB_DEFAULTS.repo})` },
      state: { type: 'string', description: 'PR state filter: open, closed, or all (default: open)' },
      per_page: { type: 'number', description: 'Results per page (default: 30, max: 100)' },
      fetch_all: { type: 'boolean', description: 'Fetch all pages (up to 1 000 PRs). Overrides per_page. Default: false.' },
    },
  },
];

export const PR_DEFAULTS: Record<string, Record<string, unknown>> = {
  'github:create_pr': { ...GITHUB_DEFAULTS, base: 'master' },
  'github:merge_pr': { ...GITHUB_DEFAULTS, merge_method: 'squash' },
  'github:enable_pr_auto_merge': { ...GITHUB_DEFAULTS, merge_method: 'squash' },
  'github:update_pr_branch': GITHUB_DEFAULTS,
  'github:pr_review': GITHUB_DEFAULTS,
  'github:pr_comment': GITHUB_DEFAULTS,
  'github:get_diff': GITHUB_DEFAULTS,
  'github:get_pr': GITHUB_DEFAULTS,
  'github:list_prs': { ...GITHUB_DEFAULTS, state: 'open', per_page: 30 },
};

const ENABLE_AUTO_MERGE_MUTATION = `
  mutation EnableAutoMerge($pullRequestId: ID!, $mergeMethod: PullRequestMergeMethod!) {
    enablePullRequestAutoMerge(input: {
      pullRequestId: $pullRequestId
      mergeMethod: $mergeMethod
    }) {
      pullRequest {
        number
        autoMergeRequest {
          enabledAt
        }
      }
    }
  }
`;

function toGraphQLMergeMethod(mergeMethod: string): 'MERGE' | 'REBASE' | 'SQUASH' {
  switch (mergeMethod) {
    case 'merge':
      return 'MERGE';
    case 'rebase':
      return 'REBASE';
    case 'squash':
    default:
      return 'SQUASH';
  }
}

async function enableAutoMerge(
  client: GitHubClient,
  pullRequestId: string,
  mergeMethod: 'MERGE' | 'REBASE' | 'SQUASH',
): Promise<{ enabled: boolean; error?: string }> {
  if (!client.token) {
    return { enabled: false, error: 'GitHub token not configured' };
  }

  const response = await fetch(`${GITHUB_API_BASE}/graphql`, {
    method: 'POST',
    headers: {
      'Accept': 'application/vnd.github+json',
      'Authorization': `Bearer ${client.token}`,
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: JSON.stringify({
      query: ENABLE_AUTO_MERGE_MUTATION,
      variables: { pullRequestId, mergeMethod },
    }),
  });

  if (!response.ok) {
    return {
      enabled: false,
      error: `GitHub GraphQL error (${response.status}): ${await response.text()}`,
    };
  }

  const payload = await response.json() as {
    errors?: Array<{ message?: string }>;
    data?: {
      enablePullRequestAutoMerge?: {
        pullRequest?: {
          autoMergeRequest?: { enabledAt?: string | null } | null;
        } | null;
      } | null;
    };
  };

  if (payload.errors?.length) {
    return {
      enabled: false,
      error: payload.errors.map((error) => error.message || 'Unknown GraphQL error').join('; '),
    };
  }

  const enabledAt =
    payload.data?.enablePullRequestAutoMerge?.pullRequest?.autoMergeRequest?.enabledAt;

  if (!enabledAt) {
    return { enabled: false, error: 'GitHub did not return auto-merge confirmation' };
  }

  return { enabled: true };
}

// ─── PR Operations ──────────────────────────────────────────────────────────

export async function prComment(client: GitHubClient, params: Record<string, unknown>): Promise<ActionResult> {
  const owner = params.owner as string | undefined;
  const repo = params.repo as string | undefined;
  const pullNumber = params.pullNumber as number | undefined;
  const body = params.body as string | undefined;

  if (!owner || !repo || !pullNumber || !body) {
    return { success: false, error: 'Missing required parameters: owner, repo, pullNumber, body' };
  }

  logger.info('Commenting on PR', { owner, repo, pullNumber, bodyLength: body.length });

  try {
    const response = await client.apiRequest(
      'POST',
      `/repos/${owner}/${repo}/issues/${pullNumber}/comments`,
      { body },
    );

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`GitHub API error (${response.status}): ${errorBody}`);
    }

    const data = await response.json() as { id: number; html_url: string };

    logger.info('PR comment created', { commentId: data.id, url: data.html_url });
    return {
      success: true,
      data: { commentId: data.id, url: data.html_url },
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger.error('Failed to comment on PR', { error: errorMsg, owner, repo, pullNumber });
    return { success: false, error: `Failed to comment on PR: ${errorMsg}` };
  }
}

export async function prReview(client: GitHubClient, params: Record<string, unknown>): Promise<ActionResult> {
  const owner = params.owner as string | undefined;
  const repo = params.repo as string | undefined;
  const pullNumber = params.pullNumber as number | undefined;
  const body = params.body as string | undefined;
  const event = params.event as string | undefined;
  const comments = params.comments as Array<{ path: string; position: number; body: string }> | undefined;

  if (!owner || !repo || !pullNumber || !event) {
    return { success: false, error: 'Missing required parameters: owner, repo, pullNumber, event' };
  }

  const validEvents = ['APPROVE', 'REQUEST_CHANGES', 'COMMENT'];
  if (!validEvents.includes(event)) {
    return { success: false, error: `Invalid review event: ${event}. Must be one of: ${validEvents.join(', ')}` };
  }

  logger.info('Submitting PR review', { owner, repo, pullNumber, event });

  try {
    const requestBody: Record<string, unknown> = { event };
    if (body) requestBody.body = body;
    if (comments && comments.length > 0) requestBody.comments = comments;

    const response = await client.apiRequest(
      'POST',
      `/repos/${owner}/${repo}/pulls/${pullNumber}/reviews`,
      requestBody,
    );

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`GitHub API error (${response.status}): ${errorBody}`);
    }

    const data = await response.json() as { id: number; state: string; html_url: string };

    logger.info('PR review submitted', { reviewId: data.id, state: data.state });
    return {
      success: true,
      data: { reviewId: data.id, state: data.state, url: data.html_url },
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger.error('Failed to submit PR review', { error: errorMsg, owner, repo, pullNumber });
    return { success: false, error: `Failed to submit PR review: ${errorMsg}` };
  }
}

export async function createPR(client: GitHubClient, params: Record<string, unknown>): Promise<ActionResult> {
  const owner = params.owner as string | undefined;
  const repo = params.repo as string | undefined;
  const title = params.title as string | undefined;
  let body = (params.body as string | undefined) ?? '';
  const head = params.head as string | undefined;
  const base = params.base as string | undefined;
  const draft = (params.draft as boolean) ?? false;
  const enableAutoMergeOnCreate = (params.enable_auto_merge as boolean | undefined) ?? true;
  const mergeMethod = (params.merge_method as string | undefined) ?? 'squash';
  const closesIssues = params.closes_issues as number[] | undefined;

  if (!owner || !repo || !title || !head || !base) {
    return { success: false, error: 'Missing required parameters: owner, repo, title, head, base' };
  }

  // ─── Deterministic issue linking: auto-append "Closes #NNN" ─────────
  if (closesIssues && closesIssues.length > 0) {
    const missing = closesIssues.filter(
      (n) => !body.includes(`Closes #${n}`) && !body.includes(`Fixes #${n}`) && !body.includes(`Resolves #${n}`),
    );
    if (missing.length > 0) {
      const closingLines = missing.map((n) => `Closes #${n}`).join('\n');
      body = body ? `${body}\n\n---\n${closingLines}` : closingLines;
    }
  }

  logger.info('Creating pull request', { owner, repo, title, head, base, draft, closesIssues });

  try {
    const requestBody: Record<string, unknown> = {
      title,
      head,
      base,
      draft,
    };
    if (body) requestBody.body = body;

    const response = await client.apiRequest(
      'POST',
      `/repos/${owner}/${repo}/pulls`,
      requestBody,
    );

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`GitHub API error (${response.status}): ${errorBody}`);
    }

    const data = await response.json() as {
      number: number;
      html_url: string;
      id: number;
      node_id?: string;
    };

    let autoMergeEnabled = false;
    let autoMergeError: string | undefined;

    if (!draft && enableAutoMergeOnCreate && data.node_id) {
      const autoMergeResult = await enableAutoMerge(
        client,
        data.node_id,
        toGraphQLMergeMethod(mergeMethod),
      );
      autoMergeEnabled = autoMergeResult.enabled;
      autoMergeError = autoMergeResult.error;

      if (autoMergeEnabled) {
        logger.info('Pull request auto-merge enabled', { prNumber: data.number, mergeMethod });
      } else if (autoMergeError) {
        logger.warn('Failed to enable pull request auto-merge', {
          prNumber: data.number,
          error: autoMergeError,
        });
      }
    }

    logger.info('Pull request created', { prNumber: data.number, url: data.html_url });
    return {
      success: true,
      data: {
        prNumber: data.number,
        prId: data.id,
        url: data.html_url,
        autoMergeEnabled,
        autoMergeError,
      },
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger.error('Failed to create pull request', { error: errorMsg, owner, repo });
    return { success: false, error: `Failed to create PR: ${errorMsg}` };
  }
}

export async function mergePR(client: GitHubClient, params: Record<string, unknown>): Promise<ActionResult> {
  const owner = params.owner as string | undefined;
  const repo = params.repo as string | undefined;
  const pullNumber = params.pullNumber as number | undefined;
  const commitTitle = params.commit_title as string | undefined;
  const mergeMethod = (params.merge_method as string) || 'squash';

  if (!owner || !repo || !pullNumber) {
    return { success: false, error: 'Missing required parameters: owner, repo, pullNumber' };
  }

  const validMethods = ['merge', 'squash', 'rebase'];
  if (!validMethods.includes(mergeMethod)) {
    return { success: false, error: `Invalid merge_method: ${mergeMethod}. Must be one of: ${validMethods.join(', ')}` };
  }

  logger.info('Merging PR', { owner, repo, pullNumber, mergeMethod });

  try {
    const prResponse = await client.apiRequest(
      'GET',
      `/repos/${owner}/${repo}/pulls/${pullNumber}`,
    );

    if (!prResponse.ok) {
      const errorBody = await prResponse.text();
      throw new Error(`GitHub API error (${prResponse.status}): ${errorBody}`);
    }

    const pr = await prResponse.json() as { merged?: boolean; state?: string };

    if (pr.merged) {
      logger.info('PR already merged (idempotent)', { pullNumber });
      return {
        success: true,
        data: { merged: true, message: 'PR already merged (idempotent)' },
      };
    }

    if (pr.state === 'closed') {
      return { success: false, error: 'PR is closed' };
    }

    const requestBody: Record<string, unknown> = {
      merge_method: mergeMethod,
    };
    if (commitTitle) requestBody.commit_title = commitTitle;

    const response = await client.apiRequest(
      'PUT',
      `/repos/${owner}/${repo}/pulls/${pullNumber}/merge`,
      requestBody,
    );

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`GitHub API error (${response.status}): ${errorBody}`);
    }

    const data = await response.json() as { sha: string; merged: boolean; message: string };

    logger.info('PR merged', { pullNumber, sha: data.sha, merged: data.merged });
    return {
      success: true,
      data: { sha: data.sha, merged: data.merged, message: data.message },
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger.error('Failed to merge PR', { error: errorMsg, owner, repo, pullNumber });
    return { success: false, error: `Failed to merge PR: ${errorMsg}` };
  }
}

export async function updatePRBranch(client: GitHubClient, params: Record<string, unknown>): Promise<ActionResult> {
  const owner = params.owner as string | undefined;
  const repo = params.repo as string | undefined;
  const pullNumber = params.pullNumber as number | undefined;
  const expectedHeadSha = params.expected_head_sha as string | undefined;

  if (!owner || !repo || !pullNumber) {
    return { success: false, error: 'Missing required parameters: owner, repo, pullNumber' };
  }

  logger.info('Updating PR branch', { owner, repo, pullNumber, expectedHeadSha });

  try {
    const requestBody: Record<string, unknown> = {};
    if (expectedHeadSha) requestBody.expected_head_sha = expectedHeadSha;

    const response = await client.apiRequest(
      'PUT',
      `/repos/${owner}/${repo}/pulls/${pullNumber}/update-branch`,
      requestBody,
    );

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`GitHub API error (${response.status}): ${errorBody}`);
    }

    const data = await response.json() as { message?: string };
    logger.info('PR branch update requested', {
      owner,
      repo,
      pullNumber,
      message: data.message,
    });
    return {
      success: true,
      data: {
        pullNumber,
        message: data.message || 'Updating pull request branch.',
      },
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger.error('Failed to update PR branch', { error: errorMsg, owner, repo, pullNumber });
    return { success: false, error: `Failed to update PR branch: ${errorMsg}` };
  }
}

export async function enablePRAutoMerge(client: GitHubClient, params: Record<string, unknown>): Promise<ActionResult> {
  const owner = params.owner as string | undefined;
  const repo = params.repo as string | undefined;
  const pullNumber = params.pullNumber as number | undefined;
  const mergeMethod = (params.merge_method as string | undefined) ?? 'squash';

  if (!owner || !repo || !pullNumber) {
    return { success: false, error: 'Missing required parameters: owner, repo, pullNumber' };
  }

  try {
    const response = await client.apiRequest('GET', `/repos/${owner}/${repo}/pulls/${pullNumber}`);
    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`GitHub API error (${response.status}): ${errorBody}`);
    }

    const pr = await response.json() as {
      state?: string;
      merged?: boolean;
      node_id?: string | null;
      auto_merge?: unknown;
    };

    if (pr.merged) {
      return { success: true, data: { enabled: false, alreadyMerged: true } };
    }
    if (pr.state !== 'open') {
      return { success: false, error: `Cannot enable auto-merge on PR #${pullNumber}: state=${String(pr.state)}` };
    }
    if (pr.auto_merge) {
      return { success: true, data: { enabled: true, alreadyEnabled: true } };
    }
    if (!pr.node_id) {
      return { success: false, error: `Missing node_id for PR #${pullNumber}` };
    }

    const result = await enableAutoMerge(client, pr.node_id, toGraphQLMergeMethod(mergeMethod));
    if (!result.enabled) {
      return { success: false, error: result.error || `Failed to enable auto-merge for PR #${pullNumber}` };
    }

    return {
      success: true,
      data: {
        enabled: true,
        pullNumber,
      },
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger.error('Failed to enable PR auto-merge', { error: errorMsg, owner, repo, pullNumber });
    return { success: false, error: `Failed to enable PR auto-merge: ${errorMsg}` };
  }
}

export async function getDiff(client: GitHubClient, params: Record<string, unknown>): Promise<ActionResult> {
  const owner = params.owner as string | undefined;
  const repo = params.repo as string | undefined;
  const pullNumber = params.pullNumber as number | undefined;

  if (!owner || !repo || !pullNumber) {
    return { success: false, error: 'Missing required parameters: owner, repo, pullNumber' };
  }

  logger.info('Getting PR diff', { owner, repo, pullNumber });

  try {
    const url = `${GITHUB_API_BASE}/repos/${owner}/${repo}/pulls/${pullNumber}`;
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'application/vnd.github.diff',
        'Authorization': `Bearer ${client.token}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`GitHub API error (${response.status}): ${errorBody}`);
    }

    const diff = await response.text();

    // Also get file list
    const filesResponse = await client.apiRequest(
      'GET',
      `/repos/${owner}/${repo}/pulls/${pullNumber}/files`,
    );
    let files: Array<Record<string, unknown>> = [];
    if (filesResponse.ok) {
      files = (await filesResponse.json() as Array<Record<string, unknown>>).map(f => ({
        filename: f.filename,
        status: f.status,
        additions: f.additions,
        deletions: f.deletions,
        changes: f.changes,
      }));
    }

    return {
      success: true,
      data: {
        diff,
        files,
        pullNumber,
      },
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger.error('Failed to get PR diff', { error: errorMsg, owner, repo, pullNumber });
    return { success: false, error: `Failed to get diff: ${errorMsg}` };
  }
}

export async function getPR(client: GitHubClient, params: Record<string, unknown>): Promise<ActionResult> {
  const owner = params.owner as string | undefined;
  const repo = params.repo as string | undefined;
  const pullNumber = params.pullNumber as number | undefined;

  if (!owner || !repo || !pullNumber) {
    return { success: false, error: 'Missing required parameters: owner, repo, pullNumber' };
  }

  logger.info('Getting PR', { owner, repo, pullNumber });

  try {
    const response = await client.apiRequest('GET', `/repos/${owner}/${repo}/pulls/${pullNumber}`);
    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`GitHub API error (${response.status}): ${errorBody}`);
    }

    const pr = await response.json() as Record<string, unknown>;
    const head = pr.head as Record<string, unknown> | undefined;
    const base = pr.base as Record<string, unknown> | undefined;
    const user = pr.user as Record<string, unknown> | undefined;

    return {
      success: true,
      data: {
        number: pr.number,
        title: pr.title,
        state: pr.state,
        mergeable: pr.mergeable,
        mergeable_state: pr.mergeable_state,
        merged: pr.merged,
        head: { sha: head?.sha, ref: head?.ref },
        base: { ref: base?.ref },
        changed_files: pr.changed_files,
        additions: pr.additions,
        deletions: pr.deletions,
        user: user?.login,
        draft: pr.draft,
        auto_merge_enabled: Boolean(pr.auto_merge),
        html_url: pr.html_url,
      },
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger.error('Failed to get PR', { error: errorMsg, owner, repo, pullNumber });
    return { success: false, error: `Failed to get PR #${pullNumber}: ${errorMsg}` };
  }
}

/** Parse the `rel="next"` URL from a GitHub Link response header. */
function parseLinkNext(linkHeader: string | null): string | null {
  if (!linkHeader) return null;
  for (const part of linkHeader.split(',')) {
    const match = part.match(/<([^>]+)>;\s*rel="next"/);
    if (match) {
      const url = match[1];
      return url.startsWith(GITHUB_API_BASE) ? url.slice(GITHUB_API_BASE.length) : url;
    }
  }
  return null;
}

const LIST_PRS_MAX_PAGES = 10;

export async function listPRs(client: GitHubClient, params: Record<string, unknown>): Promise<ActionResult> {
  const owner = params.owner as string | undefined;
  const repo = params.repo as string | undefined;
  const state = (params.state as string) || 'open';
  const fetchAll = Boolean(params.fetch_all);
  const perPage = fetchAll ? 100 : Math.min((params.per_page as number) || 30, 100);

  if (!owner || !repo) {
    return { success: false, error: 'Missing required parameters: owner, repo' };
  }

  logger.info('Listing PRs', { owner, repo, state, perPage, fetchAll });

  try {
    const allPrs: Array<Record<string, unknown>> = [];
    let pageCount = 0;
    let nextPath: string | null = `/repos/${owner}/${repo}/pulls?state=${state}&per_page=${perPage}`;

    do {
      const response = await client.apiRequest('GET', nextPath);
      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`GitHub API error (${response.status}): ${errorBody}`);
      }

      const page = await response.json() as Array<Record<string, unknown>>;
      allPrs.push(...page);
      pageCount++;

      nextPath = fetchAll ? parseLinkNext(response.headers.get('link')) : null;
    } while (nextPath !== null && pageCount < LIST_PRS_MAX_PAGES);

    const prs = allPrs;

    return {
      success: true,
      data: {
        prs: prs.map((pr) => {
          const head = pr.head as Record<string, unknown> | undefined;
          const base = pr.base as Record<string, unknown> | undefined;
          const user = pr.user as Record<string, unknown> | undefined;
          const labels = Array.isArray(pr.labels) ? pr.labels : [];
          return {
            number: pr.number,
            title: pr.title,
            state: pr.state,
            user: user?.login,
            head: { ref: head?.ref, sha: head?.sha },
            base: { ref: base?.ref },
            draft: pr.draft,
            mergeable_state: pr.mergeable_state,
            created_at: pr.created_at,
            updated_at: pr.updated_at,
            html_url: pr.html_url,
            labels: labels.map((label) => {
              const typed = (label || {}) as Record<string, unknown>;
              return {
                name: typeof typed.name === 'string' ? typed.name : undefined,
              };
            }),
          };
        }),
        total_count: prs.length,
      },
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger.error('Failed to list PRs', { error: errorMsg, owner, repo });
    return { success: false, error: `Failed to list PRs: ${errorMsg}` };
  }
}
