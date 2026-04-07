import type { RepoRegistry } from '../../config/repo-registry.js';

export async function deployGitHubPages(
  repo: string,
  registry: RepoRegistry,
): Promise<{ url?: string; details?: string }> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error('GITHUB_TOKEN not configured');

  const repoConfig = registry.get(repo);
  if (!repoConfig) throw new Error(`Repo "${repo}" not found in registry`);

  const { owner, repo: ghRepo } = repoConfig.github;

  const response = await fetch(
    `https://api.github.com/repos/${owner}/${ghRepo}/pages/deployments`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    },
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GitHub Pages API error (${response.status}): ${body}`);
  }

  const data = await response.json() as { page_url?: string; id?: number };
  return {
    url: data.page_url,
    details: `GitHub Pages deployment ${data.id || 'triggered'}`,
  };
}
