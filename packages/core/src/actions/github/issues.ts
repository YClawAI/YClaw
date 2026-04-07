import type { ActionResult } from '../types.js';
import type { ToolDefinition } from '../../config/schema.js';
import { GITHUB_DEFAULTS, normalizeLabels, type GitHubClient, logger } from './client.js';

// ─── Label Parsing Utility ───────────────────────────────────────────────────

/**
 * Robustly parse a labels parameter that may arrive in several forms from
 * an LLM tool call:
 *  - Native string array:         ["bug", "P1"]
 *  - JSON-stringified array:      '["bug","P1"]'  or  '["bug", "P1"]'
 *  - Comma-separated string:      "bug, P1"
 *  - Single label string:         "bug"
 *  - undefined / null / empty:    → []
 *
 * Each parsed label is trimmed and stripped of any surrounding quotes that
 * survive JSON.parse (e.g. from partially-mangled serialisation).
 */
export function parseLabelsParam(raw: unknown): string[] {
  if (!raw) return [];

  // Native array — use as-is (each element coerced to string + trimmed)
  if (Array.isArray(raw)) {
    return raw
      .map((l: unknown) => String(l).trim())
      .filter(Boolean);
  }

  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return [];

    // Attempt JSON parse first — handles '["bug","P1"]' and similar
    if (trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          return parsed
            .map((l: unknown) => String(l).trim())
            .filter(Boolean);
        }
      } catch {
        // fall through to comma-split below
      }
    }

    // Comma-separated string (also handles single label)
    return trimmed
      .split(',')
      .map(l => l.trim())
      .filter(Boolean);
  }

  return [];
}

// ─── Tool Definitions ────────────────────────────────────────────────────────

export const ISSUES_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'github:create_issue',
    description: 'Create a new issue',
    parameters: {
      owner: { type: 'string', description: `Repository owner (default: ${GITHUB_DEFAULTS.owner})` },
      repo: { type: 'string', description: `Repository name (default: ${GITHUB_DEFAULTS.repo})` },
      title: { type: 'string', description: 'Issue title', required: true },
      body: { type: 'string', description: 'Issue body (markdown)' },
      labels: { type: 'array', description: 'Array of label names (e.g., ["bug", "P1"])' },
    },
  },
  {
    name: 'github:update_issue',
    description: 'Update an existing issue (title, body, state, labels, assignees)',
    parameters: {
      owner: { type: 'string', description: `Repository owner (default: ${GITHUB_DEFAULTS.owner})` },
      repo: { type: 'string', description: `Repository name (default: ${GITHUB_DEFAULTS.repo})` },
      issue_number: { type: 'number', description: 'Issue number to update', required: true },
      title: { type: 'string', description: 'New title' },
      body: { type: 'string', description: 'New body (markdown)' },
      state: { type: 'string', description: 'Issue state: open or closed' },
      labels: { type: 'array', description: 'Array of label names to set' },
      assignees: { type: 'array', description: 'Array of GitHub usernames to assign' },
    },
  },
  {
    name: 'github:get_issue',
    description: 'Get a single issue by number',
    parameters: {
      owner: { type: 'string', description: `Repository owner (default: ${GITHUB_DEFAULTS.owner})` },
      repo: { type: 'string', description: `Repository name (default: ${GITHUB_DEFAULTS.repo})` },
      issue_number: { type: 'number', description: 'Issue number to retrieve', required: true },
    },
  },
  {
    name: 'github:list_issues',
    description: 'List issues in a repository with optional filters',
    parameters: {
      owner: { type: 'string', description: `Repository owner (default: ${GITHUB_DEFAULTS.owner})` },
      repo: { type: 'string', description: `Repository name (default: ${GITHUB_DEFAULTS.repo})` },
      state: { type: 'string', description: 'Issue state filter: open, closed, or all (default: open)' },
      labels: { type: 'string', description: 'Comma-separated label names to filter by' },
      per_page: { type: 'number', description: 'Results per page (default: 30, max: 100)' },
      page: { type: 'number', description: 'Page number (default: 1)' },
    },
  },
  {
    name: 'github:add_labels',
    description: 'Add labels to an issue or pull request',
    parameters: {
      owner: { type: 'string', description: `Repository owner (default: ${GITHUB_DEFAULTS.owner})` },
      repo: { type: 'string', description: `Repository name (default: ${GITHUB_DEFAULTS.repo})` },
      issue_number: { type: 'number', description: 'Issue or PR number', required: true },
      labels: { type: 'array', description: 'Array of label names to add (e.g., ["bug", "P1"])', required: true },
    },
  },
  {
    name: 'github:remove_label',
    description: 'Remove a single label from an issue or pull request',
    parameters: {
      owner: { type: 'string', description: `Repository owner (default: ${GITHUB_DEFAULTS.owner})` },
      repo: { type: 'string', description: `Repository name (default: ${GITHUB_DEFAULTS.repo})` },
      issue_number: { type: 'number', description: 'Issue or PR number', required: true },
      label: { type: 'string', description: 'Label name to remove', required: true },
    },
  },
];

export const ISSUES_DEFAULTS: Record<string, Record<string, unknown>> = {
  'github:create_issue': GITHUB_DEFAULTS,
  'github:update_issue': GITHUB_DEFAULTS,
  'github:get_issue': GITHUB_DEFAULTS,
  'github:list_issues': { ...GITHUB_DEFAULTS, state: 'open', per_page: 30, page: 1 },
  'github:add_labels': GITHUB_DEFAULTS,
  'github:remove_label': GITHUB_DEFAULTS,
};

// ─── Issue Operations ───────────────────────────────────────────────────────

export async function createIssue(client: GitHubClient, params: Record<string, unknown>): Promise<ActionResult> {
  const owner = params.owner as string | undefined;
  const repo = params.repo as string | undefined;
  const title = params.title as string | undefined;
  const body = params.body as string | undefined;
  // Handle labels in any form the LLM might send (array, JSON string, CSV, …)
  const labels = parseLabelsParam(params.labels);
  const assignees = params.assignees as string[] | undefined;

  if (!owner || !repo || !title) {
    return { success: false, error: 'Missing required parameters: owner, repo, title' };
  }

  // ─── Dedup check: search for existing similar issues ─────────────────
  const duplicate = await findDuplicateIssue(client, owner, repo, title);
  if (duplicate) {
    logger.info('Skipping duplicate issue creation — adding comment instead', {
      newTitle: title,
      existingIssue: duplicate.number,
    });

    // Add a comment to the existing issue instead
    try {
      await client.apiRequest(
        'POST',
        `/repos/${owner}/${repo}/issues/${duplicate.number}/comments`,
        { body: `**Duplicate report detected**\n\nAnother agent attempted to file a similar issue:\n> ${title}\n\n${body ? `Details:\n${body.toString().substring(0, 500)}` : ''}` },
      );
    } catch {
      // best-effort comment
    }

    return {
      success: true,
      data: {
        issueNumber: duplicate.number,
        url: duplicate.url,
        deduplicated: true,
        message: `Duplicate detected — commented on existing issue #${duplicate.number}: ${duplicate.title}`,
      },
    };
  }

  logger.info('Creating GitHub issue', { owner, repo, title });

  try {
    const requestBody: Record<string, unknown> = { title };
    if (body) requestBody.body = body;
    if (labels && labels.length > 0) requestBody.labels = normalizeLabels(labels);
    if (assignees && assignees.length > 0) requestBody.assignees = assignees;

    const response = await client.apiRequest(
      'POST',
      `/repos/${owner}/${repo}/issues`,
      requestBody,
    );

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`GitHub API error (${response.status}): ${errorBody}`);
    }

    const data = await response.json() as { number: number; html_url: string; id: number };

    logger.info('GitHub issue created', { issueNumber: data.number, url: data.html_url });
    return {
      success: true,
      data: { issueNumber: data.number, issueId: data.id, url: data.html_url },
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger.error('Failed to create GitHub issue', { error: errorMsg, owner, repo });
    return { success: false, error: `Failed to create issue: ${errorMsg}` };
  }
}

export async function getIssue(client: GitHubClient, params: Record<string, unknown>): Promise<ActionResult> {
  const owner = (params.owner as string) || GITHUB_DEFAULTS.owner;
  const repo = (params.repo as string) || GITHUB_DEFAULTS.repo;
  const issueNumber = params.issue_number as number | undefined;

  if (!issueNumber) {
    return { success: false, error: 'Missing required parameter: issue_number' };
  }

  logger.info('Getting issue', { owner, repo, issueNumber });

  try {
    const response = await client.apiRequest(
      'GET',
      `/repos/${owner}/${repo}/issues/${issueNumber}`,
    );

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`GitHub API error (${response.status}): ${errorBody}`);
    }

    const issue = await response.json() as Record<string, unknown>;

    return {
      success: true,
      data: {
        number: issue.number,
        title: issue.title,
        body: issue.body,
        state: issue.state,
        labels: (issue.labels as Array<{ name: string }>)?.map(l => l.name),
        assignees: (issue.assignees as Array<{ login: string }>)?.map(a => a.login),
        html_url: issue.html_url,
        created_at: issue.created_at,
        updated_at: issue.updated_at,
      },
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger.error('Failed to get issue', { error: errorMsg, owner, repo, issueNumber });
    return { success: false, error: `Failed to get issue #${issueNumber}: ${errorMsg}` };
  }
}

export async function listIssues(client: GitHubClient, params: Record<string, unknown>): Promise<ActionResult> {
  const owner = (params.owner as string) || GITHUB_DEFAULTS.owner;
  const repo = (params.repo as string) || GITHUB_DEFAULTS.repo;
  const state = (params.state as string) || 'open';
  const labels = (params.labels as string) || '';
  const perPage = (params.per_page as number) || 30;
  const page = (params.page as number) || 1;

  logger.info('Listing issues', { owner, repo, state, labels, perPage, page });

  try {
    const qs = new URLSearchParams({
      state,
      per_page: String(perPage),
      page: String(page),
    });
    if (labels) qs.set('labels', labels);

    const response = await client.apiRequest(
      'GET',
      `/repos/${owner}/${repo}/issues?${qs}`,
    );

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`GitHub API error (${response.status}): ${errorBody}`);
    }

    const issues = await response.json() as Array<Record<string, unknown>>;

    return {
      success: true,
      data: {
        issues: issues.map(i => ({
          number: i.number,
          title: i.title,
          state: i.state,
          labels: (i.labels as Array<{ name: string }>)?.map(l => l.name),
          assignees: (i.assignees as Array<{ login: string }>)?.map(a => a.login),
          html_url: i.html_url,
        })),
        total_count: issues.length,
      },
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger.error('Failed to list issues', { error: errorMsg, owner, repo });
    return { success: false, error: `Failed to list issues: ${errorMsg}` };
  }
}

export async function updateIssue(client: GitHubClient, params: Record<string, unknown>): Promise<ActionResult> {
  const owner = (params.owner as string) || GITHUB_DEFAULTS.owner;
  const repo = (params.repo as string) || GITHUB_DEFAULTS.repo;
  const issueNumber = (params.issue_number as number) || (params.issueNumber as number);

  if (!issueNumber) {
    return { success: false, error: 'Missing required parameter: issue_number' };
  }

  const body: Record<string, unknown> = {};
  if (params.title !== undefined) body.title = params.title;
  if (params.body !== undefined) body.body = params.body;
  if (params.state !== undefined) body.state = params.state;
  if (params.labels !== undefined) body.labels = normalizeLabels(parseLabelsParam(params.labels));
  if (params.assignees !== undefined) body.assignees = params.assignees;

  if (Object.keys(body).length === 0) {
    return { success: false, error: 'No update fields provided' };
  }

  logger.info('Updating issue', { owner, repo, issueNumber, fields: Object.keys(body) });

  try {
    const response = await client.apiRequest(
      'PATCH',
      `/repos/${owner}/${repo}/issues/${issueNumber}`,
      body,
    );

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`GitHub API error (${response.status}): ${errorBody}`);
    }

    const issue = await response.json() as Record<string, unknown>;

    logger.info('Issue updated', { owner, repo, issueNumber });
    return {
      success: true,
      data: {
        number: issue.number,
        title: issue.title,
        state: issue.state,
        html_url: issue.html_url,
      },
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger.error('Failed to update issue', { error: errorMsg, owner, repo, issueNumber });
    return { success: false, error: `Failed to update issue #${issueNumber}: ${errorMsg}` };
  }
}

export async function closeIssue(client: GitHubClient, params: Record<string, unknown>): Promise<ActionResult> {
  const owner = (params.owner as string) || GITHUB_DEFAULTS.owner;
  const repo = (params.repo as string) || GITHUB_DEFAULTS.repo;
  const issueNumber = (params.issue_number as number) || (params.issueNumber as number);
  const comment = params.comment as string | undefined;

  if (!issueNumber) {
    return { success: false, error: 'Missing required parameter: issue_number' };
  }

  try {
    const issueResponse = await client.apiRequest(
      'GET',
      `/repos/${owner}/${repo}/issues/${issueNumber}`,
    );

    if (!issueResponse.ok) {
      const errorBody = await issueResponse.text();
      throw new Error(`GitHub API error (${issueResponse.status}): ${errorBody}`);
    }

    const issue = await issueResponse.json() as { state?: string };

    if (issue.state === 'closed') {
      logger.info('Issue already closed (idempotent)', { owner, repo, issue: issueNumber });
      return {
        success: true,
        data: { issue_number: issueNumber, action: 'closed', message: 'Issue already closed (idempotent)' },
      };
    }

    // Optionally add a closing comment
    if (comment) {
      await client.apiRequest('POST', `/repos/${owner}/${repo}/issues/${issueNumber}/comments`, {
        body: comment,
      });
    }

    // Close the issue
    const response = await client.apiRequest('PATCH', `/repos/${owner}/${repo}/issues/${issueNumber}`, {
      state: 'closed',
      state_reason: 'completed',
    });

    if (!response.ok) {
      const errorMsg = await response.text();
      return { success: false, error: `Failed to close issue #${issueNumber}: ${errorMsg}` };
    }

    logger.info('Issue closed', { owner, repo, issue: issueNumber });
    return {
      success: true,
      data: { issue_number: issueNumber, action: 'closed' },
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Failed to close issue: ${errorMsg}` };
  }
}

// ─── Issue Dedup Check ──────────────────────────────────────────────────────

async function findDuplicateIssue(
  client: GitHubClient,
  owner: string,
  repo: string,
  title: string,
): Promise<{ number: number; url: string; title: string } | null> {
  // Extract significant keywords (3+ chars, skip common prefixes/emoji)
  const keywords = title
    .replace(/[^a-zA-Z0-9\s]/g, ' ')  // strip emoji/symbols
    .split(/\s+/)
    .filter(w => w.length >= 4)
    .slice(0, 5)  // max 5 keywords to keep query focused
    .join('+');

  if (!keywords) return null;

  const query = encodeURIComponent(`${keywords} repo:${owner}/${repo} is:issue is:open`);

  try {
    const response = await client.apiRequest(
      'GET',
      `/search/issues?q=${query}&per_page=5`,
    );

    if (!response.ok) {
      logger.warn('Issue dedup search failed', { status: response.status });
      return null;  // fail open — don't block issue creation
    }

    const data = await response.json() as {
      total_count: number;
      items: Array<{ number: number; html_url: string; title: string }>;
    };

    if (data.total_count === 0 || !data.items?.length) return null;

    // Check for meaningful title overlap (at least 50% keyword match)
    const titleWords = new Set(
      title.replace(/[^a-zA-Z0-9\s]/g, ' ').toLowerCase().split(/\s+/).filter(w => w.length >= 4),
    );

    for (const issue of data.items) {
      const issueWords = new Set(
        issue.title.replace(/[^a-zA-Z0-9\s]/g, ' ').toLowerCase().split(/\s+/).filter(w => w.length >= 4),
      );
      const overlap = [...titleWords].filter(w => issueWords.has(w)).length;
      const similarity = titleWords.size > 0 ? overlap / titleWords.size : 0;

      if (similarity >= 0.5) {
        logger.info('Found duplicate issue', {
          newTitle: title,
          existingIssue: issue.number,
          existingTitle: issue.title,
          similarity: Math.round(similarity * 100) + '%',
        });
        return { number: issue.number, url: issue.html_url, title: issue.title };
      }
    }

    return null;
  } catch (err) {
    logger.warn('Issue dedup search error', {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;  // fail open
  }
}

export async function addLabels(client: GitHubClient, params: Record<string, unknown>): Promise<ActionResult> {
  const owner = (params.owner as string) || GITHUB_DEFAULTS.owner;
  const repo = (params.repo as string) || GITHUB_DEFAULTS.repo;
  const issueNumber = (params.issue_number as number) || (params.issueNumber as number);
  const labels = parseLabelsParam(params.labels);

  if (!issueNumber || !labels.length) {
    return { success: false, error: 'Missing required parameters: issue_number, labels' };
  }

  const normalizedLabels = normalizeLabels(labels);

  logger.info('Adding labels', { owner, repo, issueNumber, labels: normalizedLabels });

  try {
    const response = await client.apiRequest(
      'POST',
      `/repos/${owner}/${repo}/issues/${issueNumber}/labels`,
      { labels: normalizedLabels },
    );

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`GitHub API error (${response.status}): ${errorBody}`);
    }

    const data = await response.json() as Array<{ name: string }>;

    const appliedLabels = data.map(l => l.name);
    logger.info('Labels added', { owner, repo, issueNumber, labels: appliedLabels });
    return {
      success: true,
      data: { labels: appliedLabels, issue_number: issueNumber },
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger.error('Failed to add labels', { error: errorMsg, owner, repo, issueNumber });
    return { success: false, error: `Failed to add labels: ${errorMsg}` };
  }
}

export async function removeLabel(client: GitHubClient, params: Record<string, unknown>): Promise<ActionResult> {
  const owner = (params.owner as string) || GITHUB_DEFAULTS.owner;
  const repo = (params.repo as string) || GITHUB_DEFAULTS.repo;
  const issueNumber = (params.issue_number as number) || (params.issueNumber as number);
  const label = params.label as string | undefined;

  if (!issueNumber || !label) {
    return { success: false, error: 'Missing required parameters: issue_number, label' };
  }

  const normalizedLabel = normalizeLabels([label])[0];
  const encodedLabel = encodeURIComponent(normalizedLabel);

  logger.info('Removing label', { owner, repo, issueNumber, label: normalizedLabel });

  try {
    const response = await client.apiRequest(
      'DELETE',
      `/repos/${owner}/${repo}/issues/${issueNumber}/labels/${encodedLabel}`,
    );

    if (response.status === 404) {
      // Label wasn't on the issue — idempotent success
      logger.info('Label not found on issue (idempotent)', { owner, repo, issueNumber, label: normalizedLabel });
      return { success: true, data: { label: normalizedLabel, issue_number: issueNumber, removed: false } };
    }

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`GitHub API error (${response.status}): ${errorBody}`);
    }

    logger.info('Label removed', { owner, repo, issueNumber, label: normalizedLabel });
    return { success: true, data: { label: normalizedLabel, issue_number: issueNumber, removed: true } };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger.error('Failed to remove label', { error: errorMsg, owner, repo, issueNumber });
    return { success: false, error: `Failed to remove label: ${errorMsg}` };
  }
}
