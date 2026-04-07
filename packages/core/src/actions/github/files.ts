import type { ActionResult } from '../types.js';
import type { ToolDefinition } from '../../config/schema.js';
import { GITHUB_DEFAULTS, type GitHubClient, logger } from './client.js';

// ─── Tool Definitions ────────────────────────────────────────────────────────

export const FILES_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'github:get_contents',
    description: 'Get file or directory contents from a GitHub repository. Files over 12K chars are truncated — use codegen:execute for full access to large files. Prefer get_diff for PR context.',
    parameters: {
      owner: { type: 'string', description: `Repository owner (default: ${GITHUB_DEFAULTS.owner})` },
      repo: { type: 'string', description: `Repository name (default: ${GITHUB_DEFAULTS.repo})` },
      path: { type: 'string', description: 'File or directory path (no leading slash)', required: true },
      ref: { type: 'string', description: 'Git ref — branch, tag, or SHA (default: master)' },
    },
  },
  {
    name: 'github:commit_file',
    description: 'Create or update a file on a branch via the GitHub Contents API',
    parameters: {
      owner: { type: 'string', description: `Repository owner (default: ${GITHUB_DEFAULTS.owner})` },
      repo: { type: 'string', description: `Repository name (default: ${GITHUB_DEFAULTS.repo})` },
      path: { type: 'string', description: 'File path to create or update', required: true },
      content: { type: 'string', description: 'Full file content as UTF-8 text (will be base64-encoded automatically)', required: true },
      message: { type: 'string', description: 'Commit message (imperative mood)', required: true },
      branch: { type: 'string', description: 'Target branch (must match feature/*, fix/*, agent/*, docs/*)', required: true },
      sha: { type: 'string', description: 'Current file SHA (required when updating an existing file, omit for new files)' },
    },
  },
  {
    name: 'github:commit_batch',
    description: 'Create a single commit with multiple file changes on a new or existing branch. Uses Git Trees API for atomic multi-file commits.',
    parameters: {
      owner: { type: 'string', description: `Repository owner (default: ${GITHUB_DEFAULTS.owner})` },
      repo: { type: 'string', description: `Repository name (default: ${GITHUB_DEFAULTS.repo})` },
      branch: { type: 'string', description: 'Target branch name (will be created if it does not exist)', required: true },
      base_branch: { type: 'string', description: 'Base branch to branch from (default: master)' },
      message: { type: 'string', description: 'Commit message', required: true },
      files: { type: 'array', description: 'Array of {path, content} objects. Each path is the file path, content is the full file content as UTF-8 text.', required: true },
    },
  },
  {
    name: 'github:get_multiple_files',
    description: 'Fetch contents of multiple files in one call. More efficient than calling get_contents repeatedly.',
    parameters: {
      owner: { type: 'string', description: `Repository owner (default: ${GITHUB_DEFAULTS.owner})` },
      repo: { type: 'string', description: `Repository name (default: ${GITHUB_DEFAULTS.repo})` },
      paths: { type: 'array', description: 'Array of file paths to fetch', required: true },
      ref: { type: 'string', description: 'Git ref (default: master)' },
    },
  },
];

export const FILES_DEFAULTS: Record<string, Record<string, unknown>> = {
  'github:get_contents': GITHUB_DEFAULTS,
  'github:commit_file': GITHUB_DEFAULTS,
  'github:commit_batch': { ...GITHUB_DEFAULTS, base_branch: 'master' },
  'github:get_multiple_files': { ...GITHUB_DEFAULTS, ref: 'master' },
};

// ─── File Operations ────────────────────────────────────────────────────────

export async function getContents(client: GitHubClient, params: Record<string, unknown>): Promise<ActionResult> {
  const owner = params.owner as string | undefined;
  const repo = params.repo as string | undefined;
  const path = params.path as string | undefined;
  const ref = params.ref as string | undefined;

  if (!owner || !repo || !path) {
    return { success: false, error: 'Missing required parameters: owner, repo, path' };
  }

  const pathError = client.validatePath(path);
  if (pathError) {
    return { success: false, error: pathError };
  }

  logger.info('Getting file contents', { owner, repo, path, ref });

  try {
    const queryParams = ref ? `?ref=${encodeURIComponent(ref)}` : '';
    const response = await client.apiRequest(
      'GET',
      `/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}${queryParams}`,
    );

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`GitHub API error (${response.status}): ${errorBody}`);
    }

    const data = await response.json() as Record<string, unknown>;

    // Single file — decode content from base64
    if (data.type === 'file' && typeof data.content === 'string') {
      const content = Buffer.from(data.content as string, 'base64').toString('utf-8');

      // Truncate large files to prevent context window blowout (~3K tokens)
      const MAX_CONTENT_CHARS = 12_000;
      if (content.length > MAX_CONTENT_CHARS) {
        logger.warn('File content truncated', {
          path, originalSize: content.length, truncatedTo: MAX_CONTENT_CHARS,
        });
        return {
          success: true,
          data: {
            type: 'file',
            path: data.path,
            sha: data.sha,
            size: data.size,
            content: content.substring(0, MAX_CONTENT_CHARS),
            truncated: true,
            originalSize: content.length,
            note: `File truncated from ${content.length} to ${MAX_CONTENT_CHARS} chars. Use codegen:execute for full file access or get_diff for PR context.`,
          },
        };
      }

      return {
        success: true,
        data: {
          type: 'file',
          path: data.path,
          sha: data.sha,
          size: data.size,
          content,
        },
      };
    }

    // Directory — return list of entries
    if (Array.isArray(data)) {
      const entries = (data as Array<Record<string, unknown>>).map(entry => ({
        name: entry.name,
        path: entry.path,
        type: entry.type,
        size: entry.size,
        sha: entry.sha,
      }));
      return {
        success: true,
        data: { type: 'directory', path, entries },
      };
    }

    return { success: true, data };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger.error('Failed to get contents', { error: errorMsg, owner, repo, path });
    return { success: false, error: `Failed to get contents: ${errorMsg}` };
  }
}

export async function commitFile(client: GitHubClient, params: Record<string, unknown>): Promise<ActionResult> {
  const owner = params.owner as string | undefined;
  const repo = params.repo as string | undefined;
  const path = params.path as string | undefined;
  const content = params.content as string | undefined;
  const message = params.message as string | undefined;
  const branch = params.branch as string | undefined;
  const sha = params.sha as string | undefined;

  if (!owner || !repo || !path || !content || !message) {
    return { success: false, error: 'Missing required parameters: owner, repo, path, content, message' };
  }

  // Security: enforce branch allowlist (Sentinel H-3 fix)
  const branchError = client.validateBranch(branch);
  if (branchError) {
    logger.warn('Branch validation failed', { branch, error: branchError });
    return { success: false, error: branchError };
  }

  logger.info('Committing file', { owner, repo, path, branch, isUpdate: !!sha });

  try {
    // Reject files that exceed the practical GitHub Contents API limit.
    const MAX_COMMIT_FILE_BYTES = 512 * 1024;
    if (content.length > MAX_COMMIT_FILE_BYTES) {
      return {
        success: false,
        error: `File too large for github:commit_file (${content.length} bytes > 512KB). Use codegen:execute with branch_name parameter instead.`,
      };
    }

    // Base64 encode the content
    const encodedContent = Buffer.from(content, 'utf-8').toString('base64');

    const requestBody: Record<string, unknown> = {
      message,
      content: encodedContent,
    };
    if (branch) requestBody.branch = branch;
    if (sha) requestBody.sha = sha;

    // If updating and no sha provided, try to get current sha
    if (!sha) {
      try {
        const queryParams = branch ? `?ref=${encodeURIComponent(branch)}` : '';
        const existing = await client.apiRequest(
          'GET',
          `/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}${queryParams}`,
        );
        if (existing.ok) {
          const existingData = await existing.json() as Record<string, unknown>;
          if (existingData.sha) {
            requestBody.sha = existingData.sha;
          }
        }
      } catch {
        // File doesn't exist — this is a create, which is fine
      }
    }

    const response = await client.apiRequest(
      'PUT',
      `/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}`,
      requestBody,
    );

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`GitHub API error (${response.status}): ${errorBody}`);
    }

    const data = await response.json() as {
      content: { path: string; sha: string; html_url: string };
      commit: { sha: string; message: string; html_url: string };
    };

    logger.info('File committed', {
      path: data.content.path,
      commitSha: data.commit.sha,
    });

    return {
      success: true,
      data: {
        path: data.content.path,
        fileSha: data.content.sha,
        commitSha: data.commit.sha,
        commitUrl: data.commit.html_url,
      },
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger.error('Failed to commit file', { error: errorMsg, owner, repo, path });
    return { success: false, error: `Failed to commit file: ${errorMsg}` };
  }
}

export async function commitBatch(client: GitHubClient, params: Record<string, unknown>): Promise<ActionResult> {
  const owner = params.owner as string | undefined;
  const repo = params.repo as string | undefined;
  const branch = params.branch as string | undefined;
  const baseBranch = (params.base_branch as string) || 'master';
  const message = params.message as string | undefined;
  const files = params.files as Array<{ path: string; content: string }> | undefined;

  if (!owner || !repo || !branch || !message || !files || files.length === 0) {
    return { success: false, error: 'Missing required parameters: owner, repo, branch, message, files' };
  }

  // Security: enforce branch allowlist
  const branchError = client.validateBranch(branch);
  if (branchError) {
    logger.warn('Branch validation failed for commit_batch', { branch, error: branchError });
    return { success: false, error: branchError };
  }

  logger.info('Creating batch commit', { owner, repo, branch, baseBranch, fileCount: files.length });

  try {
    // 1. Get the base branch SHA
    const refResponse = await client.apiRequest(
      'GET',
      `/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(baseBranch)}`,
    );
    if (!refResponse.ok) {
      const errorBody = await refResponse.text();
      throw new Error(`Failed to resolve base branch '${baseBranch}': ${errorBody}`);
    }
    const refData = await refResponse.json() as { object: { sha: string } };
    const baseSha = refData.object.sha;

    // 2. Create the target branch (ignore 422 if it already exists)
    const createBranchResponse = await client.apiRequest(
      'POST',
      `/repos/${owner}/${repo}/git/refs`,
      { ref: `refs/heads/${branch}`, sha: baseSha },
    );
    if (!createBranchResponse.ok && createBranchResponse.status !== 422) {
      const errorBody = await createBranchResponse.text();
      throw new Error(`Failed to create branch '${branch}': ${errorBody}`);
    }

    // 3. Get the base tree SHA from the commit
    const commitResponse = await client.apiRequest(
      'GET',
      `/repos/${owner}/${repo}/git/commits/${baseSha}`,
    );
    if (!commitResponse.ok) {
      const errorBody = await commitResponse.text();
      throw new Error(`Failed to get commit '${baseSha}': ${errorBody}`);
    }
    const commitData = await commitResponse.json() as { tree: { sha: string } };
    const baseTreeSha = commitData.tree.sha;

    // 4. Create blobs for each file in parallel
    const blobResults = await Promise.all(
      files.map(async (file) => {
        const pathError = client.validatePath(file.path);
        if (pathError) throw new Error(`Invalid file path '${file.path}': ${pathError}`);

        const blobResponse = await client.apiRequest(
          'POST',
          `/repos/${owner}/${repo}/git/blobs`,
          { content: file.content, encoding: 'utf-8' },
        );
        if (!blobResponse.ok) {
          const errorBody = await blobResponse.text();
          throw new Error(`Failed to create blob for '${file.path}': ${errorBody}`);
        }
        const blobData = await blobResponse.json() as { sha: string };
        return { path: file.path, sha: blobData.sha };
      }),
    );

    // 5. Create a new tree with all blobs
    const treeResponse = await client.apiRequest(
      'POST',
      `/repos/${owner}/${repo}/git/trees`,
      {
        base_tree: baseTreeSha,
        tree: blobResults.map(b => ({
          path: b.path,
          mode: '100644',
          type: 'blob',
          sha: b.sha,
        })),
      },
    );
    if (!treeResponse.ok) {
      const errorBody = await treeResponse.text();
      throw new Error(`Failed to create tree: ${errorBody}`);
    }
    const treeData = await treeResponse.json() as { sha: string };
    const treeSha = treeData.sha;

    // 6. Create the commit
    const newCommitResponse = await client.apiRequest(
      'POST',
      `/repos/${owner}/${repo}/git/commits`,
      { message, tree: treeSha, parents: [baseSha] },
    );
    if (!newCommitResponse.ok) {
      const errorBody = await newCommitResponse.text();
      throw new Error(`Failed to create commit: ${errorBody}`);
    }
    const newCommitData = await newCommitResponse.json() as { sha: string };
    const commitSha = newCommitData.sha;

    // 7. Update the branch ref
    const updateRefResponse = await client.apiRequest(
      'PATCH',
      `/repos/${owner}/${repo}/git/refs/heads/${encodeURIComponent(branch)}`,
      { sha: commitSha },
    );
    if (!updateRefResponse.ok) {
      const errorBody = await updateRefResponse.text();
      throw new Error(`Failed to update branch ref: ${errorBody}`);
    }

    logger.info('Batch commit created', { commitSha, branch, fileCount: files.length });
    return {
      success: true,
      data: { sha: commitSha, branch, files_committed: files.length },
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger.error('Failed to create batch commit', { error: errorMsg, owner, repo, branch });
    return { success: false, error: `Failed to commit batch: ${errorMsg}` };
  }
}

export async function getMultipleFiles(client: GitHubClient, params: Record<string, unknown>): Promise<ActionResult> {
  const owner = params.owner as string | undefined;
  const repo = params.repo as string | undefined;
  const paths = params.paths as string[] | undefined;
  const ref = params.ref as string | undefined;

  if (!owner || !repo || !paths || paths.length === 0) {
    return { success: false, error: 'Missing required parameters: owner, repo, paths' };
  }

  logger.info('Fetching multiple files', { owner, repo, pathCount: paths.length, ref });

  const results = await Promise.allSettled(
    paths.map(path => getContents(client, { owner, repo, path, ref })),
  );

  const files: Record<string, unknown> = {};
  for (let i = 0; i < paths.length; i++) {
    const path = paths[i]!;
    const result = results[i]!;
    if (result.status === 'fulfilled' && result.value.success) {
      files[path] = result.value.data;
    } else {
      const error = result.status === 'rejected'
        ? String(result.reason)
        : result.value.error || 'Unknown error';
      files[path] = { error };
    }
  }

  return { success: true, data: { files } };
}
