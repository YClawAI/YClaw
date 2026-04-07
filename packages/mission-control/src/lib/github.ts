import { Octokit } from '@octokit/rest';

let octokit: Octokit | null = null;

export function getOctokit(): Octokit | null {
  const token = process.env.GITHUB_TOKEN;
  if (!token) return null;

  if (!octokit) {
    octokit = new Octokit({ auth: token });
  }
  return octokit;
}
