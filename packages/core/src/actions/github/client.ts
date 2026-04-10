import { createLogger } from '../../logging/logger.js';
import { getGitHubToken, isGitHubAuthAvailable, initGitHubAuth } from './app-auth.js';

const logger = createLogger('github-executor');

// ─── Rate-limit Error ────────────────────────────────────────────────────────

/**
 * Thrown by `apiRequest` when GitHub responds with a 429 or a 403 with
 * X-RateLimit-Remaining: 0.  Callers (e.g. the PR-hygiene cron) should catch
 * this and skip the current cycle instead of retrying immediately.
 */
export class GitHubRateLimitError extends Error {
  /** Unix epoch (ms) at which the caller may resume requests. */
  readonly retryAfterMs: number;

  constructor(retryAfterMs: number, message?: string) {
    super(message ?? `GitHub rate limit hit — retry after ${new Date(retryAfterMs).toISOString()}`);
    this.name = 'GitHubRateLimitError';
    this.retryAfterMs = retryAfterMs;
  }
}

// Module-level backoff state.  Once set, all subsequent apiRequest() calls
// will throw GitHubRateLimitError without making a network request.
let _rateLimitBackoffUntilMs = 0;

/** Returns the epoch-ms timestamp until which outgoing requests are suppressed (0 = no backoff). */
export function getRateLimitBackoffUntilMs(): number {
  return _rateLimitBackoffUntilMs;
}

/** Force-clear the backoff (useful in tests). */
export function clearRateLimitBackoff(): void {
  _rateLimitBackoffUntilMs = 0;
}

/**
 * Parse the earliest epoch-ms at which requests may resume from a GitHub
 * rate-limit response.  Checks (in order):
 *   1. `Retry-After` header — integer seconds (RFC 7231 delta-seconds) or
 *      HTTP-date string (e.g. "Wed, 21 Oct 2015 07:28:00 GMT")
 *   2. `X-RateLimit-Reset` header (Unix timestamp in seconds)
 *
 * Falls back to `now + 60 s` when neither header is present.
 */
function parseRetryAfterMs(headers: Headers): number {
  const retryAfter = headers.get('Retry-After');
  if (retryAfter) {
    // Try integer delta-seconds first.
    const seconds = parseInt(retryAfter, 10);
    if (!isNaN(seconds) && seconds > 0) {
      return Date.now() + seconds * 1000;
    }
    // Fall back to HTTP-date format (e.g. "Wed, 21 Oct 2015 07:28:00 GMT").
    const httpDate = new Date(retryAfter);
    if (!isNaN(httpDate.getTime())) {
      return httpDate.getTime();
    }
  }

  const resetHeader = headers.get('X-RateLimit-Reset');
  if (resetHeader) {
    const resetEpoch = parseInt(resetHeader, 10);
    if (!isNaN(resetEpoch) && resetEpoch > 0) {
      return resetEpoch * 1000;
    }
  }

  // Conservative fallback: back off for 60 seconds.
  return Date.now() + 60_000;
}

export const GITHUB_API_BASE = 'https://api.github.com';

export const GITHUB_DEFAULTS = {
  owner: 'your-org',
  repo: 'yclaw',
} as const;

// ─── Label Normalization ─────────────────────────────────────────────────────
// Maps bare label names (as agents know them) to emoji-prefixed display names.
// Agents use simple names like "bug" or "P1" in their tool calls; this map
// ensures the correct emoji label is applied on GitHub. If a label isn't in
// the map, it passes through unchanged.
const LABEL_NORMALIZATION: Record<string, string> = {
  // Priority
  'p0': '🔴 P0',
  'P0': '🔴 P0',
  'p1': '🟠 P1',
  'P1': '🟠 P1',
  'p2': '🟡 P2',
  'P2': '🟡 P2',
  'p3': '🟢 P3',
  'P3': '🟢 P3',
  'priority-highest': '🚨 priority-highest',
  // Type
  'bug': '🐛 bug',
  'enhancement': '✨ enhancement',
  'documentation': '📝 documentation',
  'docs': '📝 documentation',
  'question': '❓ question',
  'chore': '🧹 chore',
  'test': '🧪 test',
  'testing': '🧪 test',
  'QA': '🧪 QA',
  'qa': '🧪 QA',
  'duplicate': '♊ duplicate',
  'invalid': '❌ invalid',
  'wontfix': '🚫 wontfix',
  // Status
  'blocked': '🚧 blocked',
  'blocking': '⛔ blocking',
  'blocker': '⛔ blocking',
  'in-progress': '🚧 in-progress',
  // Agent/automation
  'agent-work': '🤖 agent-work',
  'designer': '🎨 designer',
  'human-only': '🙅 human-only',
  'ao-eligible': '🤖 ao-eligible',
  'ao-complete': '✅ ao-complete',
  'needs-human': '🙅 needs-human',
  'coordination': '🔗 coordination',
  'security-sensitive': '🔒 security-sensitive',
  'UI': '🎨 UI',
  // Infrastructure
  'infrastructure': '🏗️ infrastructure',
  'agent-infrastructure': '⚙️ agent-infrastructure',
  'event-bus': '📡 event-bus',
  'routing': '🔀 routing',
  'caching': '💾 caching',
  'mcp': '🔌 mcp',
  'tooling': '🔧 tooling',
  // Domain
  'deploy-governance': '🚀 deploy-governance',
  'deployment': '🚀 deploy-governance',
  'deploy-pipeline': '🚀 deploy-governance',
  'governance': '🚀 deploy-governance',
  'safety': '🛡️ safety',
  'development': '💻 development',
  'memory-architecture': '🧠 memory-architecture',
  'figma': '🎨 figma',
  // Meta
  'good first issue': '👋 good first issue',
  'good-first-issue': '👋 good first issue',
  'help wanted': '🙏 help wanted',
  'follow-up': '🧹 chore',
  'cleanup': '🧹 chore',
  'tech-debt': '🧹 chore',
  'incident': '🔴 P0',
  'review-feedback': '🟡 P2',
  'review-followup': '🟡 P2',
};

/** Normalize a label name to its emoji-prefixed version. */
export function normalizeLabel(label: string): string {
  return LABEL_NORMALIZATION[label] ?? label;
}

/** Normalize an array of labels, deduplicating after normalization. */
export function normalizeLabels(labels: string[]): string[] {
  return [...new Set(labels.map(normalizeLabel))];
}

// ─── Branch & Path Validation ────────────────────────────────────────────────

const ALLOWED_BRANCH_PATTERNS = [
  /^feature\//,
  /^fix\//,
  /^agent\//,
  /^docs\//,
];

const BLOCKED_BRANCHES = ['master', 'main', 'production', 'release'];

// ─── GitHub Client ───────────────────────────────────────────────────────────

export class GitHubClient {
  /**
   * @deprecated Use getGitHubToken() for dynamic token retrieval.
   * Retained for backward compatibility — reads the current token synchronously
   * (PAT only; returns null when only App auth is configured).
   */
  get token(): string | null {
    return process.env.GITHUB_TOKEN || null;
  }

  constructor() {
    initGitHubAuth();
  }

  isReady(): boolean {
    return isGitHubAuthAvailable();
  }

  async healthCheck(): Promise<boolean> {
    if (!isGitHubAuthAvailable()) return false;
    try {
      const response = await this.apiRequest('GET', '/user');
      return response.ok;
    } catch (err) {
      logger.error('GitHub health check failed', { error: (err as Error).message });
      return false;
    }
  }

  /** Path validation — blocks traversal and sensitive file access (Sentinel H-1 fix). */
  validatePath(path: string): string | null {
    if (path.includes('..') || path.startsWith('/')) {
      return `Invalid path '${path}' — path traversal not allowed`;
    }
    const blockedPatterns = ['.env', '.git/', 'secrets', '.pem', '.key'];
    for (const pattern of blockedPatterns) {
      if (path.toLowerCase().includes(pattern)) {
        return `Path '${path}' matches blocked pattern '${pattern}'`;
      }
    }
    return null;
  }

  /** Branch validation — agents can only write to feature/agent branches (Sentinel H-3 fix). */
  validateBranch(branch: string | undefined): string | null {
    if (!branch) return 'Branch is required for commit_file (cannot commit to default branch)';
    if (BLOCKED_BRANCHES.includes(branch.toLowerCase())) {
      return `Branch '${branch}' is protected — commits must go through PRs`;
    }
    const allowed = ALLOWED_BRANCH_PATTERNS.some(p => p.test(branch));
    if (!allowed) {
      return `Branch '${branch}' does not match allowed patterns (feature/*, fix/*, agent/*, docs/*)`;
    }
    return null;
  }

  async apiRequest(
    method: string,
    path: string,
    body?: Record<string, unknown>,
  ): Promise<Response> {
    // ── Pre-flight: honour any active backoff window ──────────────────────────
    if (_rateLimitBackoffUntilMs > Date.now()) {
      throw new GitHubRateLimitError(_rateLimitBackoffUntilMs);
    }

    const token = await getGitHubToken();
    const url = `${GITHUB_API_BASE}${path}`;

    const headers: Record<string, string> = {
      'Accept': 'application/vnd.github+json',
      'Authorization': `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
    };

    if (body) {
      headers['Content-Type'] = 'application/json';
    }

    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    // ── Detect rate-limit responses ───────────────────────────────────────────
    const isRateLimited =
      response.status === 429 ||
      (response.status === 403 &&
        (response.headers.get('X-RateLimit-Remaining') === '0' ||
         response.headers.has('retry-after')));

    if (isRateLimited) {
      const backoffUntilMs = parseRetryAfterMs(response.headers);
      _rateLimitBackoffUntilMs = backoffUntilMs;
      logger.warn('GitHub rate limit detected — suppressing requests', {
        status: response.status,
        backoffUntil: new Date(backoffUntilMs).toISOString(),
      });
      throw new GitHubRateLimitError(backoffUntilMs);
    }

    return response;
  }
}

export { logger };
