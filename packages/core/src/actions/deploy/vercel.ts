import type { RepoConfig } from '../../config/repo-schema.js';
import type { RepoRegistry } from '../../config/repo-registry.js';
import { createLogger } from '../../logging/logger.js';

const logger = createLogger('deploy-vercel');

export async function deployVercel(
  repo: string,
  environment: string,
  registry: RepoRegistry,
  commitSha?: string,
): Promise<{ url?: string; details?: string }> {
  const token = process.env.VERCEL_TOKEN;
  if (!token) throw new Error('VERCEL_TOKEN not configured');

  const repoConfig = registry.get(repo);
  if (!repoConfig) throw new Error(`Repo "${repo}" not found in registry`);

  const orgId = repoConfig.deployment.vercel_org_id || process.env.VERCEL_ORG_ID;
  const teamQuery = orgId ? `?teamId=${orgId}` : '';
  const authHeaders = { 'Authorization': `Bearer ${token}` };

  let projectId = repoConfig.deployment.vercel_project_id || process.env.VERCEL_PROJECT_ID;
  if (!projectId) {
    projectId = await resolveVercelProject(repo, repoConfig, teamQuery, authHeaders);
  }

  const target = environment === 'production' ? 'production' : 'preview';
  const createBody: Record<string, unknown> = { name: repo, project: projectId, target };

  if (commitSha) {
    createBody.gitSource = {
      type: 'github',
      ref: commitSha,
      org: repoConfig.github.owner,
      repo: repoConfig.github.repo,
    };
  }

  logger.info('Creating Vercel deployment', { repo, environment, target, projectId, commitSha });

  const createResp = await fetch(
    `https://api.vercel.com/v13/deployments${teamQuery}`,
    {
      method: 'POST',
      headers: { ...authHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify(createBody),
    },
  );

  if (!createResp.ok) {
    const errBody = await createResp.text();
    throw new Error(`Vercel create deployment failed (${createResp.status}): ${errBody}`);
  }

  const deployment = await createResp.json() as { id: string; url: string; readyState: string };
  const maxWaitMs = 5 * 60 * 1000;
  const pollIntervalMs = 5_000;
  const start = Date.now();

  while (Date.now() - start < maxWaitMs) {
    await new Promise(r => setTimeout(r, pollIntervalMs));

    const statusResp = await fetch(
      `https://api.vercel.com/v13/deployments/${deployment.id}${teamQuery}`,
      { headers: authHeaders },
    );

    if (!statusResp.ok) continue;

    const status = await statusResp.json() as { readyState: string; url: string; alias?: string[] };

    if (status.readyState === 'READY') {
      const liveUrl = status.alias?.[0] ? `https://${status.alias[0]}` : `https://${status.url}`;
      return { url: liveUrl, details: `Vercel deployment ${deployment.id} (${target}) ready` };
    }

    if (status.readyState === 'ERROR' || status.readyState === 'CANCELED') {
      throw new Error(`Vercel deployment ${deployment.id} failed: ${status.readyState}`);
    }
  }

  return {
    url: `https://${deployment.url}`,
    details: `Vercel deployment ${deployment.id} (${target}) — still building`,
  };
}

async function resolveVercelProject(
  repo: string,
  repoConfig: RepoConfig,
  teamQuery: string,
  authHeaders: Record<string, string>,
): Promise<string> {
  logger.info('No Vercel project ID configured, attempting auto-discover', { repo });

  const findResp = await fetch(
    `https://api.vercel.com/v9/projects/${repo}${teamQuery}`,
    { headers: authHeaders },
  );

  if (findResp.ok) {
    const project = await findResp.json() as { id: string; name: string };
    return project.id;
  }

  const framework = repoConfig.tech_stack.framework || undefined;
  const createBody: Record<string, unknown> = {
    name: repo,
    framework: framework === 'next' ? 'nextjs' : framework,
    gitRepository: {
      type: 'github',
      repo: `${repoConfig.github.owner}/${repoConfig.github.repo}`,
    },
  };

  const createResp = await fetch(
    `https://api.vercel.com/v10/projects${teamQuery}`,
    {
      method: 'POST',
      headers: { ...authHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify(createBody),
    },
  );

  if (!createResp.ok) {
    const errBody = await createResp.text();
    throw new Error(`Failed to auto-create Vercel project for ${repo} (${createResp.status}): ${errBody}`);
  }

  const newProject = await createResp.json() as { id: string; name: string };
  return newProject.id;
}
