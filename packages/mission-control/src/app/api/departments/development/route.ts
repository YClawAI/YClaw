import { NextResponse } from 'next/server';
import { getDepartmentData } from '@/lib/department-data';
import { getOctokit } from '@/lib/github';
import { redisZcard } from '@/lib/redis';

export const dynamic = 'force-dynamic';

export async function GET() {
  const base = await getDepartmentData(['architect', 'builder', 'deployer', 'designer']);

  // GitHub data
  const github: { openPRs: number; reviewReady: number; failingCI: number; recentCommits: { sha: string; message: string; author: string; date: string | undefined }[] } = {
    openPRs: 0, reviewReady: 0, failingCI: 0, recentCommits: [],
  };
  const octokit = getOctokit();
  if (octokit) {
    try {
      const [prs, commits] = await Promise.all([
        octokit.pulls.list({ owner: 'yclaw-ai', repo: 'yclaw', state: 'open', per_page: 30 }),
        octokit.repos.listCommits({ owner: 'yclaw-ai', repo: 'yclaw', per_page: 15 }),
      ]);
      github.openPRs = prs.data.length;
      github.reviewReady = prs.data.filter(p => p.labels?.some(l => l.name === 'review-ready')).length;
      github.recentCommits = commits.data.map(c => ({
        sha: c.sha.slice(0, 7),
        message: c.commit.message.split('\n')[0].slice(0, 80),
        author: c.commit.author?.name || 'unknown',
        date: c.commit.author?.date,
      }));

      // Check CI status on open PRs
      let failing = 0;
      for (const pr of prs.data.slice(0, 10)) {
        try {
          const checks = await octokit.checks.listForRef({
            owner: 'yclaw-ai', repo: 'yclaw', ref: pr.head.sha,
          });
          if (checks.data.check_runs.some(r => r.conclusion === 'failure')) failing++;
        } catch { /* skip */ }
      }
      github.failingCI = failing;
    } catch { /* graceful */ }
  }

  // Queue depths
  const queues = { P0: 0, P1: 0, P2: 0, P3: 0 };
  try {
    for (const p of ['P0', 'P1', 'P2', 'P3'] as const) {
      queues[p] = await redisZcard(`builder:task_queue:${p}`);
    }
  } catch { /* graceful */ }

  return NextResponse.json({ ...base, github, queues });
}
