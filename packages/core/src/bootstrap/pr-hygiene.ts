import { isAutomatedPrAuthor } from './ci-repair.js';

export interface ListedPullRequestSummary {
  number?: number;
  user?: string;
  state?: string;
  draft?: boolean;
  title?: string;
  html_url?: string;
  labels?: Array<{
    name?: string;
  }>;
  created_at?: string;
  head?: {
    ref?: string;
    sha?: string;
  };
  base?: {
    ref?: string;
  };
}

export interface PullRequestHygieneCandidate {
  prNumber: number;
  author: string;
  baseBranch: string;
  headBranch: string;
  createdAt?: string;
  title?: string;
  url?: string;
}

export function listPrHygieneCandidatesByBase(
  prs: ListedPullRequestSummary[],
): Map<string, PullRequestHygieneCandidate[]> {
  const byBase = new Map<string, PullRequestHygieneCandidate[]>();

  for (const pr of prs) {
    if (pr.state !== 'open' || pr.draft === true) continue;
    if (!isAutomatedPrAuthor(pr.user)) continue;
    if (typeof pr.number !== 'number') continue;
    if (pr.labels?.some((label) => label.name === 'needs-human')) continue;

    const baseBranch = pr.base?.ref;
    const headBranch = pr.head?.ref;
    if (!baseBranch || !headBranch) continue;

    const candidate: PullRequestHygieneCandidate = {
      prNumber: pr.number,
      author: pr.user || 'unknown',
      baseBranch,
      headBranch,
      createdAt: pr.created_at,
      title: pr.title,
      url: pr.html_url,
    };

    const list = byBase.get(baseBranch) || [];
    list.push(candidate);
    byBase.set(baseBranch, list);
  }

  for (const [baseBranch, list] of byBase.entries()) {
    byBase.set(baseBranch, list.sort((a, b) => {
      const aTime = a.createdAt ? Date.parse(a.createdAt) : Number.POSITIVE_INFINITY;
      const bTime = b.createdAt ? Date.parse(b.createdAt) : Number.POSITIVE_INFINITY;
      return aTime - bTime;
    }));
  }

  return byBase;
}

export function selectPrHygieneCandidates(
  prs: ListedPullRequestSummary[],
): PullRequestHygieneCandidate[] {
  return [...listPrHygieneCandidatesByBase(prs).values()]
    .map((list) => list[0])
    .filter((candidate): candidate is PullRequestHygieneCandidate => Boolean(candidate))
    .sort((a, b) => {
      const aTime = a.createdAt ? Date.parse(a.createdAt) : Number.POSITIVE_INFINITY;
      const bTime = b.createdAt ? Date.parse(b.createdAt) : Number.POSITIVE_INFINITY;
      return aTime - bTime;
    });
}

export function hasNeedsHumanLabel(pr: ListedPullRequestSummary): boolean {
  return Boolean(pr.labels?.some((label) => label.name === 'needs-human'));
}

export function shouldLabelNeedsHuman(mergeableState: string | undefined): boolean {
  return mergeableState === 'dirty';
}
