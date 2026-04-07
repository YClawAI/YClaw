/**
 * GitHub repo source — public repos only, tarball fetch.
 *
 * Council change #7:
 * - Public repos only (no auth tokens, no private repo access)
 * - Shallow archive fetch via GitHub API tarball endpoint
 * - No submodules, no git-lfs
 * - Index only key files: README, docs/, package.json, etc.
 * - Max 500MB archive size
 */

import { createLogger } from '../../logging/logger.js';
import type { IObjectStore } from '../../interfaces/IObjectStore.js';
import { createProvenance } from '../provenance.js';
import { MAX_GITHUB_REPO_BYTES, GITHUB_INDEX_PATHS, ASSET_KEY_PREFIX } from '../constants.js';
import type { OnboardingAsset, AssetClassification } from '../types.js';

const logger = createLogger('onboarding:github-source');

interface RepoInfo {
  owner: string;
  repo: string;
  branch: string;
}

/** Parse a GitHub URL into owner/repo/branch. */
export function parseGitHubUrl(url: string): RepoInfo {
  const parsed = new URL(url);
  if (parsed.hostname !== 'github.com') {
    throw new Error('Only github.com URLs are supported');
  }

  const parts = parsed.pathname.split('/').filter(Boolean);
  if (parts.length < 2) {
    throw new Error('Invalid GitHub URL — expected github.com/owner/repo');
  }

  return {
    owner: parts[0]!,
    repo: parts[1]!.replace(/\.git$/, ''),
    branch: parts[3] ?? 'HEAD', // /owner/repo/tree/branch
  };
}

/**
 * Fetch a single file from a public GitHub repo via the raw content API.
 * Returns null if the file doesn't exist (404).
 */
async function fetchGitHubFile(owner: string, repo: string, path: string, ref: string): Promise<string | null> {
  const url = `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${path}`;
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(10_000),
      headers: { 'User-Agent': 'YCLAW-Onboarding/1.0' },
    });
    if (!response.ok) return null;
    return response.text();
  } catch {
    return null;
  }
}

/**
 * Fetch repo metadata from GitHub API (public, no auth needed).
 */
async function fetchRepoInfo(owner: string, repo: string): Promise<{
  defaultBranch: string;
  size: number;
  description: string;
}> {
  const url = `https://api.github.com/repos/${owner}/${repo}`;
  const response = await fetch(url, {
    signal: AbortSignal.timeout(10_000),
    headers: {
      'User-Agent': 'YCLAW-Onboarding/1.0',
      'Accept': 'application/vnd.github.v3+json',
    },
  });

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error(`Repository ${owner}/${repo} not found or is private`);
    }
    throw new Error(`GitHub API error: ${response.status}`);
  }

  const data = await response.json() as {
    default_branch: string;
    size: number;
    description: string | null;
  };

  return {
    defaultBranch: data.default_branch,
    size: data.size * 1024, // GitHub API reports size in KB
    description: data.description ?? '',
  };
}

export async function processGitHubRepo(
  repoUrl: string,
  sessionId: string,
  jobId: string,
  objectStore: IObjectStore,
  branch?: string,
): Promise<OnboardingAsset> {
  const { owner, repo } = parseGitHubUrl(repoUrl);

  // Fetch repo metadata to validate size and get default branch
  const info = await fetchRepoInfo(owner, repo);

  if (info.size > MAX_GITHUB_REPO_BYTES) {
    throw new Error(`Repository size ${info.size} exceeds maximum ${MAX_GITHUB_REPO_BYTES} bytes`);
  }

  const ref = branch ?? info.defaultBranch;

  // Index key files (council change #7: only specific paths)
  const indexedContent: string[] = [];

  if (info.description) {
    indexedContent.push(`# Repository: ${owner}/${repo}\n\n${info.description}\n`);
  }

  for (const path of GITHUB_INDEX_PATHS) {
    // Skip directory patterns — we'll try specific files
    if (path.endsWith('/')) continue;

    const content = await fetchGitHubFile(owner, repo, path, ref);
    if (content) {
      indexedContent.push(`## ${path}\n\n${content}\n`);
    }
  }

  const extractedText = indexedContent.join('\n---\n\n');
  const contentBuffer = Buffer.from(extractedText, 'utf8');
  const prov = createProvenance('github', repoUrl, contentBuffer, jobId);

  // Store indexed content in object store
  const objectKey = `${ASSET_KEY_PREFIX}${sessionId}/${prov.contentHash}/${owner}-${repo}`;
  await objectStore.put(objectKey, contentBuffer, { contentType: 'text/markdown' });

  logger.info('GitHub repo indexed', {
    repo: `${owner}/${repo}`,
    ref,
    indexedFiles: indexedContent.length,
    textSize: extractedText.length,
  });

  return {
    assetId: prov.importJobId,
    source: 'github',
    sourceUri: repoUrl,
    filename: `${owner}/${repo}`,
    contentHash: prov.contentHash,
    summary: '',
    classification: 'technical_spec' as AssetClassification,
    extractedText,
    importJobId: jobId,
    importedAt: prov.importedAt,
    sizeBytes: contentBuffer.length,
    objectKey,
  };
}
