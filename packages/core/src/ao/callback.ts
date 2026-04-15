import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';
import { createLogger } from '../logging/logger.js';
import type { AuditLog } from '../logging/audit.js';
import type { EventBus } from '../triggers/event.js';
import type { AoCallbackEvent } from './types.js';
import { getGitHubToken, isGitHubAuthAvailable } from '../actions/github/app-auth.js';
import { GITHUB_ORG_DEFAULTS } from '../config/github-defaults.js';

const logger = createLogger('ao-callback');

const FAILURE_TYPES = new Set([
  'session.failed',
  'ci.failed',
]);

// ─── False-positive resolution constants ─────────────────────────────────────
/** How many times to poll GitHub before giving up on finding a PR. */
const PR_POLL_ATTEMPTS = 4;
/** Delay between polling attempts in milliseconds. */
const PR_POLL_INTERVAL_MS = 15_000;

// ─── Slack Notifications ──────────────────────────────────────────────────────

const EVENT_SLACK_MAP: Record<string, { emoji: string; template: (e: AoCallbackEvent) => string }> = {
  'session.started': {
    emoji: '🟢',
    template: (e) => `AO spawned coding session for *#${e.issueNumber || '?'}*${e.repo ? ` in \`${e.repo}\`` : ''}`,
  },
  'session.completed': {
    emoji: '✅',
    template: (e) => `AO completed work on *#${e.issueNumber || '?'}*${e.repo ? ` in \`${e.repo}\`` : ''}`,
  },
  'pr.ready': {
    emoji: '📝',
    template: (e) => `AO opened PR${e.prNumber ? ` *#${e.prNumber}*` : ''} for *#${e.issueNumber || '?'}*${e.prUrl ? ` — ${e.prUrl}` : ''}`,
  },
  'pr.created': {
    emoji: '📝',
    template: (e) => `AO opened PR${e.prNumber ? ` *#${e.prNumber}*` : ''} for *#${e.issueNumber || '?'}*${e.prUrl ? ` — ${e.prUrl}` : ''}`,
  },
  'pr.merged': {
    emoji: '🎉',
    template: (e) => `PR merged for *#${e.issueNumber || '?'}*${e.prUrl ? ` — ${e.prUrl}` : ''}`,
  },
  'session.failed': {
    emoji: '❌',
    template: (e) => `AO session failed for *#${e.issueNumber || '?'}*${e.error ? `: ${e.error.slice(0, 200)}` : ''}`,
  },
  'ci.failed': {
    emoji: '🔴',
    template: (e) => `CI failed for *#${e.issueNumber || '?'}*${e.error ? `: ${e.error.slice(0, 200)}` : ''}`,
  },
};

async function notifySlack(event: AoCallbackEvent): Promise<void> {
  if (process.env.AO_SLACK_NOTIFICATIONS === 'false') return;

  const aoSlackChannel = process.env.AO_SLACK_CHANNEL || '';
  if (!aoSlackChannel) {
    logger.debug('[AO Callback] AO_SLACK_CHANNEL not set — skipping Slack notification');
    return;
  }

  const slackToken = process.env.SLACK_BOT_TOKEN;
  if (!slackToken) {
    logger.debug('[AO Callback] SLACK_BOT_TOKEN not set — skipping Slack notification');
    return;
  }

  const mapping = EVENT_SLACK_MAP[event.type];
  if (!mapping) {
    // Unknown event type — post a generic notification
    const text = `🔔 AO event: \`${event.type}\`${event.issueNumber ? ` for #${event.issueNumber}` : ''}`;
    await postSlackMessage(slackToken, text);
    return;
  }

  const text = `${mapping.emoji} ${mapping.template(event)}`;
  const messageTs = await postSlackMessage(slackToken, text);

  // For session.failed, check whether a PR was opened — if so, this may be a
  // false-positive (cleanup error after successful work). Resolve it in the background.
  if (event.type === 'session.failed' && event.issueNumber && messageTs) {
    resolveFailureAlertIfPRExists(slackToken, messageTs, event.issueNumber, event.repo).catch((err) => {
      logger.warn('[AO Callback] false-positive resolution error', {
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }
}

/**
 * Returns the message `ts` (Slack timestamp) on success, or `null` on failure.
 * The `ts` is needed to post threaded replies.
 */
async function postSlackMessage(
  token: string,
  text: string,
  threadTs?: string,
): Promise<string | null> {
  try {
    const res = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        channel: process.env.AO_SLACK_CHANNEL || '',
        text,
        username: 'AO',
        icon_emoji: ':robot_face:',
        ...(threadTs ? { thread_ts: threadTs } : {}),
      }),
    });
    const data = await res.json() as { ok: boolean; error?: string; ts?: string };
    if (!data.ok) {
      logger.warn('[AO Callback] Slack post failed', { error: data.error });
      return null;
    }
    return data.ts ?? null;
  } catch (err) {
    logger.warn('[AO Callback] Slack post error', {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * Add a reaction emoji to a Slack message. Errors are swallowed — reactions
 * are cosmetic and should never block the main flow.
 */
async function addSlackReaction(
  token: string,
  channel: string,
  ts: string,
  emoji: string,
): Promise<void> {
  try {
    const res = await fetch('https://slack.com/api/reactions.add', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ channel, name: emoji, timestamp: ts }),
    });
    const data = await res.json() as { ok: boolean; error?: string };
    if (!data.ok && data.error !== 'already_reacted') {
      logger.debug('[AO Callback] Slack reaction failed', { error: data.error });
    }
  } catch (err) {
    logger.debug('[AO Callback] Slack reaction error', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Parse a `repo` field that may be `"owner/repo"` or just `"repo"`.
 * Falls back to the default org when no owner is present.
 */
function parseOwnerRepo(repo: string | undefined): { owner: string; repoName: string } {
  if (!repo) return { owner: GITHUB_ORG_DEFAULTS.owner, repoName: GITHUB_ORG_DEFAULTS.repo };
  if (repo.includes('/')) {
    const [owner, ...rest] = repo.split('/');
    return { owner: owner || GITHUB_ORG_DEFAULTS.owner, repoName: rest.join('/') || GITHUB_ORG_DEFAULTS.repo };
  }
  return { owner: GITHUB_ORG_DEFAULTS.owner, repoName: repo };
}

interface GitHubPR {
  number: number;
  html_url: string;
  created_at: string;
  state: string;
}

/**
 * Search GitHub for any PR (open or recently merged/closed) that references
 * the given issue number in its body or title.
 *
 * Returns the first matching PR, or `null` if none found.
 */
async function findPRForIssue(
  owner: string,
  repoName: string,
  issueNumber: number,
): Promise<GitHubPR | null> {
  if (!isGitHubAuthAvailable()) {
    logger.debug('[AO Callback] GitHub auth not configured — skipping PR lookup');
    return null;
  }
  const githubToken = await getGitHubToken();

  // Search for PRs that mention the issue number in any field (title, body).
  // The query "#{issueNumber}" matches common patterns like "Closes #913".
  const q = encodeURIComponent(
    `is:pr repo:${owner}/${repoName} #${issueNumber}`,
  );

  try {
    const res = await fetch(
      `https://api.github.com/search/issues?q=${q}&sort=created&order=desc&per_page=5`,
      {
        headers: {
          'Authorization': `Bearer ${githubToken}`,
          'Accept': 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'yclaw/ao-callback',
        },
      },
    );

    if (!res.ok) {
      logger.warn('[AO Callback] GitHub search failed', { status: res.status });
      return null;
    }

    const data = await res.json() as { total_count: number; items: GitHubPR[] };
    if (data.total_count === 0 || !data.items.length) return null;

    return data.items[0] ?? null;
  } catch (err) {
    logger.warn('[AO Callback] GitHub PR lookup error', {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * After a `session.failed` alert is posted, poll GitHub (up to ~60 s) to see
 * whether a PR was opened for the issue. If a PR is found, post a threaded
 * ✅ reply so non-technical users can see at a glance that the work succeeded
 * and the failure was only a cleanup error.
 */
async function resolveFailureAlertIfPRExists(
  slackToken: string,
  failureMessageTs: string,
  issueNumber: number,
  repo: string | undefined,
): Promise<void> {
  const { owner, repoName } = parseOwnerRepo(repo);

  for (let attempt = 0; attempt < PR_POLL_ATTEMPTS; attempt++) {
    // Brief pause before each attempt (including the first, to allow AO to
    // finish creating the PR if it raced with the failure callback).
    if (attempt > 0) {
      await new Promise(resolve => setTimeout(resolve, PR_POLL_INTERVAL_MS));
    }

    const pr = await findPRForIssue(owner, repoName, issueNumber);
    if (!pr) continue;

    logger.info('[AO Callback] PR found for failed session — resolving false-positive alert', {
      issueNumber,
      prNumber: pr.number,
      prUrl: pr.html_url,
    });

    const replyText =
      `✅ Resolved — PR #${pr.number} was opened successfully for issue #${issueNumber}. ` +
      `The failure was a cleanup error, not a code failure. ${pr.html_url}`;

    await postSlackMessage(slackToken, replyText, failureMessageTs);

    // Add a ✅ reaction to the original failure message for quick visual scanning.
    await addSlackReaction(slackToken, process.env.AO_SLACK_CHANNEL || '', failureMessageTs, 'white_check_mark');

    return;
  }

  logger.debug('[AO Callback] No PR found after polling — leaving failure alert unresolved', {
    issueNumber,
  });
}

// ─── Discord Webhook Notifications ───────────────────────────────────────────

async function notifyDiscord(event: AoCallbackEvent): Promise<void> {
  const webhookUrl = FAILURE_TYPES.has(event.type)
    ? process.env.DISCORD_WEBHOOK_ALERTS
    : process.env.DISCORD_WEBHOOK_DEVELOPMENT;

  if (!webhookUrl) {
    logger.debug('[AO Callback] Discord webhook not configured — skipping');
    return;
  }

  const mapping = EVENT_SLACK_MAP[event.type];
  // Slack uses *bold*, Discord uses **bold** — convert single * to **
  const raw = mapping
    ? `${mapping.emoji} ${mapping.template(event)}`
    : `🔔 AO event: \`${event.type}\`${event.issueNumber ? ` for #${event.issueNumber}` : ''}`;
  const text = raw.replace(/(?<!\*)\*(?!\*)([^*]+)\*(?!\*)/g, '**$1**');

  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'AO Pipeline',
        content: text,
      }),
    });
    if (!res.ok) {
      logger.warn('[AO Callback] Discord webhook failed', { status: res.status });
    }
  } catch (err) {
    logger.warn('[AO Callback] Discord webhook error', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// ─── GitHub Issue Comments on Failure ────────────────────────────────────────

async function commentOnIssueFailure(event: AoCallbackEvent): Promise<void> {
  if (!FAILURE_TYPES.has(event.type)) return;
  if (!event.issueNumber) return;
  if (!isGitHubAuthAvailable()) return;

  const { owner, repoName } = parseOwnerRepo(event.repo);

  let token: string;
  try {
    token = await getGitHubToken();
  } catch {
    logger.debug('[AO Callback] GitHub token unavailable — skipping issue comment');
    return;
  }

  const body = `⚠️ **AO session failed**\n\n` +
    `- **Session:** ${event.sessionId || 'unknown'}\n` +
    `- **Reason:** ${event.error || (event as unknown as Record<string, unknown>).subtype || event.type}\n` +
    `- **Time:** ${new Date().toISOString()}\n\n` +
    `The automated coding session did not produce any commits. This may indicate ` +
    `the issue scope is too large for automated processing, or the session hit its turn limit.\n\n` +
    `Consider breaking this issue into smaller, more targeted sub-issues.`;

  try {
    const res = await fetch(
      `https://api.github.com/repos/${owner}/${repoName}/issues/${event.issueNumber}/comments`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'yclaw/ao-callback',
        },
        body: JSON.stringify({ body }),
      },
    );
    if (!res.ok) {
      logger.warn('[AO Callback] GitHub comment failed', { status: res.status });
    }
  } catch (err) {
    logger.warn('[AO Callback] GitHub comment error', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

function safeCompare(a: string, b: string): boolean {
  // HMAC both inputs to normalize length — prevents timing-based length leakage
  const key = 'ao-callback-compare';
  const ha = createHmac('sha256', key).update(a).digest();
  const hb = createHmac('sha256', key).update(b).digest();
  return timingSafeEqual(ha, hb);
}

export function createAoCallbackMiddleware(
  eventBus: EventBus,
  auditLog: AuditLog,
) {
  const authToken = process.env.AO_AUTH_TOKEN;

  return async (req: Request, res: Response): Promise<void> => {
    // Auth: reject all if AO_AUTH_TOKEN not configured (fail-closed)
    if (!authToken) {
      logger.error('[AO Callback] AO_AUTH_TOKEN not configured — rejecting all callbacks');
      res.status(503).json({ error: 'Server misconfigured' });
      return;
    }

    // Timing-safe token comparison (handle Express array headers)
    const rawToken = req.headers['x-ao-token'];
    const providedToken = Array.isArray(rawToken) ? rawToken[0] || '' : rawToken || '';
    if (!safeCompare(authToken, providedToken)) {
      logger.warn('[AO Callback] unauthorized callback attempt');
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const body = req.body;
    if (!body || typeof body !== 'object') {
      logger.warn('[AO Callback] malformed callback body');
      res.status(400).json({ error: 'Bad request — expected JSON object' });
      return;
    }

    const event = body as AoCallbackEvent;
    if (!event.type) {
      logger.warn('[AO Callback] missing event type');
      res.status(400).json({ error: 'Bad request — missing type field' });
      return;
    }

    logger.info('[AO Callback] received', {
      type: event.type,
      sessionId: event.sessionId,
      issueNumber: event.issueNumber,
      repo: event.repo,
    });

    // Audit log
    try {
      const db = auditLog.getDb();
      if (db) {
        await db.collection('audit_log').insertOne({
          agent: 'ao-callback',
          action: 'callback_received',
          event,
          timestamp: new Date().toISOString(),
        });
      }
    } catch (err) {
      logger.warn('[AO Callback] audit write failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // Normalize AO callback payload to snake_case before publishing.
    // AoCallbackEvent uses camelCase (issueNumber, prNumber, prUrl, sessionId, issueUrl)
    // but the event-schema registry and all consumer prompts expect snake_case.
    // We keep the raw event for Slack templates (which reference camelCase fields).
    const payload: Record<string, unknown> = {
      ...event,
      ...(event.issueNumber !== undefined && { issue_number: event.issueNumber }),
      ...(event.issueUrl   !== undefined && { issue_url:    event.issueUrl }),
      ...(event.sessionId  !== undefined && { session_id:   event.sessionId }),
      ...(event.prNumber   !== undefined && { pr_number:    event.prNumber }),
      ...(event.prUrl      !== undefined && { pr_url:       event.prUrl }),
    };
    // Remove the camelCase originals so downstream consumers only see snake_case
    delete payload['issueNumber'];
    delete payload['issueUrl'];
    delete payload['sessionId'];
    delete payload['prNumber'];
    delete payload['prUrl'];

    if (event.type === 'session.completed') {
      await eventBus.publish('ao-callback', 'task_completed', payload);
    } else if (event.type === 'pr.ready' || event.type === 'pr.created') {
      await eventBus.publish('ao-callback', 'pr_ready', payload);
    } else if (event.type === 'pr.merged') {
      await eventBus.publish('ao-callback', 'pr_merged', payload);
    } else if (FAILURE_TYPES.has(event.type)) {
      await eventBus.publish('ao-callback', 'task_failed', payload);
    } else {
      await eventBus.publish('ao-callback', event.type, payload);
    }

    // Notifications — fire and forget, never block response
    notifySlack(event).catch((err) => {
      logger.warn('[AO Callback] Slack notification failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    });
    notifyDiscord(event).catch((err) => {
      logger.warn('[AO Callback] Discord notification failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    });
    commentOnIssueFailure(event).catch((err) => {
      logger.warn('[AO Callback] GitHub issue comment failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    });

    res.json({ received: true, type: event.type });
  };
}
