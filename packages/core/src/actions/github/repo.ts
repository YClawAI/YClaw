import type { ActionResult } from '../types.js';
import type { ToolDefinition } from '../../config/schema.js';
import { GITHUB_API_BASE, GITHUB_DEFAULTS, DEFAULT_BRANCH, type GitHubClient, logger } from './client.js';

// ─── Tool Definitions ────────────────────────────────────────────────────────

export const REPO_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'github:update_repo_settings',
    description: 'Update repository settings such as auto-merge support',
    parameters: {
      owner: { type: 'string', description: `Repository owner (default: ${GITHUB_DEFAULTS.owner})` },
      repo: { type: 'string', description: `Repository name (default: ${GITHUB_DEFAULTS.repo})` },
      allow_auto_merge: { type: 'boolean', description: 'Enable or disable GitHub native auto-merge' },
      delete_branch_on_merge: { type: 'boolean', description: 'Delete head branches automatically after merge' },
    },
  },
  {
    name: 'github:create_branch',
    description: 'Create a new branch from an existing ref',
    parameters: {
      owner: { type: 'string', description: `Repository owner (default: ${GITHUB_DEFAULTS.owner})` },
      repo: { type: 'string', description: `Repository name (default: ${GITHUB_DEFAULTS.repo})` },
      branch: { type: 'string', description: 'New branch name (e.g., feature/add-caching)', required: true },
      from_ref: { type: 'string', description: `Source ref to branch from (default: ${DEFAULT_BRANCH})` },
    },
  },
  {
    name: 'github:get_workflow_runs',
    description: 'Get recent GitHub Actions workflow runs for a repository, optionally filtered by branch and status',
    parameters: {
      owner: { type: 'string', description: `Repository owner (default: ${GITHUB_DEFAULTS.owner})` },
      repo: { type: 'string', description: `Repository name (default: ${GITHUB_DEFAULTS.repo})` },
      branch: { type: 'string', description: 'Filter by branch name' },
      status: { type: 'string', description: 'Filter by status: completed, in_progress, queued' },
      per_page: { type: 'number', description: 'Results per page (default: 10, max: 100)' },
    },
  },
];

export const REPO_DEFAULTS: Record<string, Record<string, unknown>> = {
  'github:update_repo_settings': GITHUB_DEFAULTS,
  'github:create_branch': { ...GITHUB_DEFAULTS, from_ref: DEFAULT_BRANCH },
  'github:get_workflow_runs': { ...GITHUB_DEFAULTS, per_page: 10 },
};

// ─── Repo Operations ────────────────────────────────────────────────────────

export async function createRepo(client: GitHubClient, params: Record<string, unknown>): Promise<ActionResult> {
  const org = params.org as string | undefined;
  const name = params.name as string | undefined;
  const description = params.description as string | undefined;
  const isPrivate = (params.private as boolean) ?? false;

  if (!org || !name) {
    return { success: false, error: 'Missing required parameters: org, name' };
  }

  logger.info('Creating GitHub repository', { org, name });

  try {
    const requestBody: Record<string, unknown> = {
      name,
      private: isPrivate,
      auto_init: true,
    };
    if (description) requestBody.description = description;

    const response = await client.apiRequest(
      'POST',
      `/orgs/${org}/repos`,
      requestBody,
    );

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`GitHub API error (${response.status}): ${errorBody}`);
    }

    const data = await response.json() as {
      full_name: string;
      html_url: string;
      default_branch: string;
    };

    logger.info('Repository created', { fullName: data.full_name, url: data.html_url });
    return {
      success: true,
      data: {
        full_name: data.full_name,
        url: data.html_url,
        default_branch: data.default_branch,
      },
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger.error('Failed to create repository', { error: errorMsg, org, name });
    return { success: false, error: `Failed to create repo: ${errorMsg}` };
  }
}

export async function configureWebhook(client: GitHubClient, params: Record<string, unknown>): Promise<ActionResult> {
  const owner = params.owner as string | undefined;
  const repo = params.repo as string | undefined;
  const url = params.url as string | undefined;
  const secret = params.secret as string | undefined;
  const events = params.events as string[] | undefined;

  if (!owner || !repo || !url) {
    return { success: false, error: 'Missing required parameters: owner, repo, url' };
  }

  const webhookSecret = secret || process.env.GITHUB_WEBHOOK_SECRET || '';
  const webhookEvents = events || [
    'issues', 'pull_request', 'pull_request_review', 'workflow_run',
  ];

  logger.info('Configuring webhook', { owner, repo, url, events: webhookEvents });

  try {
    const requestBody = {
      name: 'web',
      active: true,
      config: {
        url,
        content_type: 'json',
        secret: webhookSecret,
        insecure_ssl: '0',
      },
      events: webhookEvents,
    };

    const response = await client.apiRequest(
      'POST',
      `/repos/${owner}/${repo}/hooks`,
      requestBody as unknown as Record<string, unknown>,
    );

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`GitHub API error (${response.status}): ${errorBody}`);
    }

    const data = await response.json() as { id: number; config: { url: string } };

    logger.info('Webhook configured', { hookId: data.id, url: data.config.url });
    return {
      success: true,
      data: { hookId: data.id, url: data.config.url, events: webhookEvents },
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger.error('Failed to configure webhook', { error: errorMsg, owner, repo });
    return { success: false, error: `Failed to configure webhook: ${errorMsg}` };
  }
}

export async function updateRepoSettings(client: GitHubClient, params: Record<string, unknown>): Promise<ActionResult> {
  const owner = params.owner as string | undefined;
  const repo = params.repo as string | undefined;
  const allowAutoMerge = params.allow_auto_merge as boolean | undefined;
  const deleteBranchOnMerge = params.delete_branch_on_merge as boolean | undefined;

  if (!owner || !repo) {
    return { success: false, error: 'Missing required parameters: owner, repo' };
  }

  const requestBody: Record<string, unknown> = {};
  if (typeof allowAutoMerge === 'boolean') requestBody.allow_auto_merge = allowAutoMerge;
  if (typeof deleteBranchOnMerge === 'boolean') requestBody.delete_branch_on_merge = deleteBranchOnMerge;

  if (Object.keys(requestBody).length === 0) {
    return { success: false, error: 'At least one repository setting must be provided' };
  }

  logger.info('Updating repository settings', { owner, repo, requestBody });

  try {
    const response = await client.apiRequest(
      'PATCH',
      `/repos/${owner}/${repo}`,
      requestBody,
    );

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`GitHub API error (${response.status}): ${errorBody}`);
    }

    const data = await response.json() as {
      full_name: string;
      allow_auto_merge: boolean;
      delete_branch_on_merge?: boolean;
      default_branch: string;
      html_url: string;
    };

    logger.info('Repository settings updated', {
      repo: data.full_name,
      allowAutoMerge: data.allow_auto_merge,
      deleteBranchOnMerge: data.delete_branch_on_merge,
    });

    return {
      success: true,
      data: {
        full_name: data.full_name,
        allow_auto_merge: data.allow_auto_merge,
        delete_branch_on_merge: data.delete_branch_on_merge,
        default_branch: data.default_branch,
        url: data.html_url,
      },
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger.error('Failed to update repository settings', { error: errorMsg, owner, repo });
    return { success: false, error: `Failed to update repository settings: ${errorMsg}` };
  }
}

export async function createBranch(client: GitHubClient, params: Record<string, unknown>): Promise<ActionResult> {
  const owner = params.owner as string | undefined;
  const repo = params.repo as string | undefined;
  const branch = params.branch as string | undefined;
  const fromRef = (params.from_ref as string) || DEFAULT_BRANCH;

  if (!owner || !repo || !branch) {
    return { success: false, error: 'Missing required parameters: owner, repo, branch' };
  }

  logger.info('Creating branch', { owner, repo, branch, fromRef });

  try {
    // Get the SHA of the source ref
    const refResponse = await client.apiRequest(
      'GET',
      `/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(fromRef)}`,
    );

    if (!refResponse.ok) {
      const errorBody = await refResponse.text();
      throw new Error(`Failed to resolve ref '${fromRef}': ${errorBody}`);
    }

    const refData = await refResponse.json() as { object: { sha: string } };
    const sourceSha = refData.object.sha;

    // Create the new branch
    let response = await client.apiRequest(
      'POST',
      `/repos/${owner}/${repo}/git/refs`,
      {
        ref: `refs/heads/${branch}`,
        sha: sourceSha,
      },
    );

    // If branch already exists (422), update it to the source SHA
    if (response.status === 422) {
      logger.info('Branch already exists, updating ref', { branch, sha: sourceSha });
      response = await client.apiRequest(
        'PATCH',
        `/repos/${owner}/${repo}/git/refs/heads/${encodeURIComponent(branch)}`,
        { sha: sourceSha, force: true },
      );
    }

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`GitHub API error (${response.status}): ${errorBody}`);
    }

    const data = await response.json() as { ref: string; object: { sha: string } };

    logger.info('Branch created', { branch, sha: data.object.sha });
    return {
      success: true,
      data: {
        ref: data.ref,
        sha: data.object.sha,
        branch,
        fromRef,
      },
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger.error('Failed to create branch', { error: errorMsg, owner, repo, branch });
    return { success: false, error: `Failed to create branch: ${errorMsg}` };
  }
}

export async function compareCommits(client: GitHubClient, params: Record<string, unknown>): Promise<ActionResult> {
  const owner = (params.owner as string) || 'your-org';
  const repo = (params.repo as string) || 'yclaw';
  const base = params.base as string | undefined;
  const head = params.head as string | undefined;

  if (!base || !head) {
    return { success: false, error: 'Both "base" and "head" parameters are required for compare_commits' };
  }

  logger.info(`Comparing commits: ${owner}/${repo} ${base}...${head}`);

  try {
    const url = `${GITHUB_API_BASE}/repos/${owner}/${repo}/compare/${base}...${head}`;
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'application/vnd.github+json',
        'Authorization': `Bearer ${client.token}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`GitHub API error (${response.status}): ${errorBody}`);
    }

    const data = await response.json() as Record<string, unknown>;
    const files = ((data.files as Array<Record<string, unknown>>) ?? []).map(f => ({
      filename: f.filename,
      status: f.status ?? 'unknown',
      additions: f.additions,
      deletions: f.deletions,
      patch: f.patch,
    }));

    return {
      success: true,
      data: {
        files,
        total_commits: data.total_commits,
        ahead_by: data.ahead_by,
      },
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger.error(`Failed to compare commits: ${errorMsg}`, { owner, repo, base, head });
    return { success: false, error: `Failed to compare commits ${base}...${head}: ${errorMsg}` };
  }
}

export async function getWorkflowRuns(client: GitHubClient, params: Record<string, unknown>): Promise<ActionResult> {
  const owner = params.owner as string | undefined;
  const repo = params.repo as string | undefined;
  const branch = params.branch as string | undefined;
  const status = params.status as string | undefined;
  const perPage = Math.min((params.per_page as number) || 10, 100);

  if (!owner || !repo) {
    return { success: false, error: 'Missing required parameters: owner, repo' };
  }

  logger.info('Getting workflow runs', { owner, repo, branch, status, perPage });

  try {
    let url = `/repos/${owner}/${repo}/actions/runs?per_page=${perPage}`;
    if (branch) url += `&branch=${encodeURIComponent(branch)}`;
    if (status) url += `&status=${status}`;

    const response = await client.apiRequest('GET', url);
    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`GitHub API error (${response.status}): ${errorBody}`);
    }

    const data = await response.json() as {
      total_count: number;
      workflow_runs: Array<Record<string, unknown>>;
    };

    return {
      success: true,
      data: {
        total_count: data.total_count,
        runs: data.workflow_runs.map((r) => ({
          id: r.id,
          name: r.name,
          status: r.status,
          conclusion: r.conclusion,
          head_branch: r.head_branch,
          head_sha: r.head_sha,
          html_url: r.html_url,
          created_at: r.created_at,
          updated_at: r.updated_at,
        })),
      },
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger.error('Failed to get workflow runs', { error: errorMsg, owner, repo });
    return { success: false, error: `Failed to get workflow runs: ${errorMsg}` };
  }
}
