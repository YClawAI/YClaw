import type { Redis } from 'ioredis';
import type { EventStream } from '../services/event-stream.js';
import type { GitHubExecutor } from '../actions/github/index.js';
import type {
  YClawEvent,
  CoordReviewPayload,
  CoordProjectPayload,
} from '../types/events.js';
import { createLogger } from '../logging/logger.js';
import { GITHUB_ORG_DEFAULTS } from '../config/github-defaults.js';

// ─── Constants ──────────────────────────────────────────────────────────────

/** Hidden HTML comment embedded in every Journaler-created GitHub comment/issue. */
export const JOURNALER_MARKER = '<!-- yclaw-journaler -->';

const ISSUE_MAPPING_KEY = 'journaler:project_issues';
const DEFAULT_ISSUE_KEY = 'journaler:default_issue';
const MAPPING_TTL_S = 30 * 24 * 60 * 60; // 30 days
const RATE_LIMIT_MS = 2000; // 1 comment per 2 seconds
const DEFAULT_OWNER = GITHUB_ORG_DEFAULTS.owner;
const DEFAULT_REPO = GITHUB_ORG_DEFAULTS.repo;

// ─── Event Classification ───────────────────────────────────────────────────

/** Milestone events that generate GitHub comments. */
export const MILESTONE_TYPES = new Set([
  'coord.deliverable.submitted',
  'coord.deliverable.approved',
  'coord.deliverable.changes_requested',
  'coord.review.completed',
  'coord.task.blocked',
  'coord.task.completed',
  'coord.task.failed',
  'coord.project.kicked_off',
  'coord.project.phase_completed',
  'coord.project.completed',
]);

/** Noise events — explicitly ignored, no log noise for these. */
const NOISE_TYPES = new Set([
  'coord.task.requested',
  'coord.task.accepted',
  'coord.task.started',
]);

// ─── Agent Emoji Map ────────────────────────────────────────────────────────

const AGENT_EMOJI: Record<string, string> = {
  strategist: '\u{1F9E0}',  // 🧠
  builder: '\u{1F6E0}\uFE0F', // 🛠️
  architect: '\u{1F4D0}',   // 📐
  designer: '\u{1F3A8}',    // 🎨
  deployer: '\u{1F680}',    // 🚀
  reviewer: '\u{1F4CB}',    // 📋
  scout: '\u{1F50D}',       // 🔍
  ember: '\u{1F525}',       // 🔥
  forge: '\u2692\uFE0F',    // ⚒️
  sentinel: '\u{1F6E1}\uFE0F', // 🛡️
  treasurer: '\u{1F4B0}',   // 💰
  keeper: '\u{1F3E0}',      // 🏠
  guide: '\u{1F4DA}',       // 📚
};

// ─── Types ──────────────────────────────────────────────────────────────────

interface IssueMapping {
  repo: string;
  issue_number: number;
}

type QueueItem = () => Promise<void>;

// ─── Journaler ──────────────────────────────────────────────────────────────

/**
 * Subscribes to coord.* events via Redis Streams and posts milestone events
 * as formatted Markdown comments on GitHub project issues.
 *
 * Non-milestone events (noise) are silently dropped. GitHub API failures are
 * caught and logged — the Journaler never crashes on external errors.
 */
export class Journaler {
  private readonly log = createLogger('journaler');
  private lastCommentAt = 0;
  private readonly queue: QueueItem[] = [];
  private processing = false;
  private defaultIssueNumber: number | null = null;

  constructor(
    private readonly redis: Redis,
    private readonly eventStream: EventStream,
    private readonly github: GitHubExecutor,
    private readonly owner = DEFAULT_OWNER,
    private readonly repo = DEFAULT_REPO,
  ) {}

  /** Start consuming coord.* events from Redis Streams. */
  async start(): Promise<void> {
    this.eventStream.subscribeStream('coord', 'journaler', async (event) => {
      await this.handleEvent(event);
    });
    this.log.info('Journaler started, subscribed to coord.* events');
  }

  // ─── Event Handling ─────────────────────────────────────────────────────

  private async handleEvent(event: YClawEvent<unknown>): Promise<void> {
    // Skip noise — no log output for known-noisy types
    if (NOISE_TYPES.has(event.type)) return;
    if (event.type.startsWith('coord.status.')) return;

    // Skip non-milestone events
    if (!MILESTONE_TYPES.has(event.type)) {
      this.log.debug('Skipping non-milestone event', { type: event.type });
      return;
    }

    try {
      const issueNumber = await this.resolveIssue(event);
      const comment = formatComment(event);
      await this.enqueueComment(issueNumber, comment);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.log.error('Failed to process milestone event', {
        type: event.type, correlation_id: event.correlation_id, error: msg,
      });
    }
  }

  // ─── Issue Resolution ───────────────────────────────────────────────────

  private async resolveIssue(event: YClawEvent<unknown>): Promise<number> {
    // Project kickoff → create a dedicated tracking issue
    if (event.type === 'coord.project.kicked_off') {
      return this.createProjectIssue(
        event.correlation_id,
        event.payload as CoordProjectPayload,
      );
    }

    // Look up existing mapping for this correlation
    const raw = await this.redis.hget(ISSUE_MAPPING_KEY, event.correlation_id);
    if (raw) {
      const mapping = JSON.parse(raw) as IssueMapping;
      // Refresh TTL on access
      await this.redis.expire(ISSUE_MAPPING_KEY, MAPPING_TTL_S);
      return mapping.issue_number;
    }

    // No mapping → fall back to the default coordination log issue
    return this.getOrCreateDefaultIssue();
  }

  private async createProjectIssue(
    correlationId: string,
    payload: CoordProjectPayload,
  ): Promise<number> {
    const title = `[Project] ${payload.summary || payload.project_id}`;
    const bodyParts = [
      JOURNALER_MARKER,
      '## Project Coordination Log',
      '',
      `**Project ID:** \`${payload.project_id}\``,
    ];
    if (payload.phase) bodyParts.push(`**Phase:** ${payload.phase}`);
    if (payload.agents?.length) {
      bodyParts.push(`**Agents:** ${payload.agents.join(', ')}`);
    }
    if (payload.summary) bodyParts.push(`**Summary:** ${payload.summary}`);
    bodyParts.push(
      '',
      '---',
      '_This issue is auto-managed by the YClaw Journaler. Milestone events for this project will appear as comments below._',
    );

    const result = await this.github.execute('github:create_issue', {
      owner: this.owner,
      repo: this.repo,
      title,
      body: bodyParts.join('\n'),
      labels: ['coordination'],
    });

    if (!result.success || !result.data?.issueNumber) {
      throw new Error(
        `Failed to create project issue: ${result.error || 'no issue number returned'}`,
      );
    }

    const issueNumber = result.data.issueNumber as number;

    // Store mapping
    await this.redis.hset(
      ISSUE_MAPPING_KEY,
      correlationId,
      JSON.stringify({ repo: this.repo, issue_number: issueNumber } satisfies IssueMapping),
    );
    await this.redis.expire(ISSUE_MAPPING_KEY, MAPPING_TTL_S);

    this.log.info('Created project tracking issue', { correlationId, issueNumber });
    return issueNumber;
  }

  private async getOrCreateDefaultIssue(): Promise<number> {
    if (this.defaultIssueNumber) return this.defaultIssueNumber;

    // Check Redis for a previously created default issue
    const cached = await this.redis.get(DEFAULT_ISSUE_KEY);
    if (cached) {
      this.defaultIssueNumber = parseInt(cached, 10);
      return this.defaultIssueNumber;
    }

    // Create a new default coordination log issue
    const result = await this.github.execute('github:create_issue', {
      owner: this.owner,
      repo: this.repo,
      title: '[Coordination] Event Log',
      body: [
        JOURNALER_MARKER,
        '## Coordination Event Log',
        '',
        '_Milestone events without a specific project correlation are logged here._',
        '_This issue is auto-managed by the YClaw Journaler._',
      ].join('\n'),
      labels: ['coordination'],
    });

    if (!result.success || !result.data?.issueNumber) {
      throw new Error(
        `Failed to create default coordination issue: ${result.error || 'unknown'}`,
      );
    }

    this.defaultIssueNumber = result.data.issueNumber as number;
    await this.redis.set(DEFAULT_ISSUE_KEY, String(this.defaultIssueNumber));

    this.log.info('Created default coordination issue', {
      issueNumber: this.defaultIssueNumber,
    });
    return this.defaultIssueNumber;
  }

  // ─── Rate-Limited Comment Queue ─────────────────────────────────────────

  private async enqueueComment(issueNumber: number, body: string): Promise<void> {
    this.queue.push(async () => {
      // Enforce rate limit: max 1 GitHub comment per 2 seconds
      const elapsed = Date.now() - this.lastCommentAt;
      if (elapsed < RATE_LIMIT_MS) {
        await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_MS - elapsed));
      }

      try {
        // GitHub Issues API and PR comments share the same endpoint
        await this.github.execute('github:pr_comment', {
          owner: this.owner,
          repo: this.repo,
          pullNumber: issueNumber,
          body,
        });
        this.lastCommentAt = Date.now();
        this.log.info('Posted milestone comment', { issueNumber });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.log.error('Failed to post comment', { issueNumber, error: msg });
      }
    });

    if (!this.processing) {
      void this.processQueue();
    }
  }

  private async processQueue(): Promise<void> {
    this.processing = true;
    while (this.queue.length > 0) {
      const task = this.queue.shift()!;
      try {
        await task();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.log.error('Queue task failed', { error: msg });
      }
    }
    this.processing = false;
  }
}

// ─── Comment Formatting (pure, exported for testing) ────────────────────────

/** Format a YClawEvent into a Markdown GitHub comment. */
export function formatComment(event: YClawEvent<unknown>): string {
  const source = event.source || 'system';
  const emoji = AGENT_EMOJI[source] || '\u{1F514}'; // 🔔
  const agentName = source.charAt(0).toUpperCase() + source.slice(1);
  const action = describeAction(event);
  const payload = event.payload as Record<string, unknown>;

  const lines: string[] = [
    JOURNALER_MARKER,
    `${emoji} **[${agentName}]** ${action}`,
  ];

  // Artifact link
  if (payload.artifact_url) {
    lines.push(`**Artifact:** [link](${payload.artifact_url})`);
  }

  // Correlation + task ID metadata
  const idParts: string[] = [];
  if (event.correlation_id) {
    idParts.push(`**Correlation:** \`${event.correlation_id}\``);
  }
  if (payload.task_id) {
    idParts.push(`**Task:** \`${payload.task_id}\``);
  }
  if (idParts.length) lines.push(idParts.join(' | '));

  // Blocked events — show what's needed
  if (event.type === 'coord.task.blocked' && payload.message) {
    lines.push(`**Needs:** ${payload.message}`);
  }

  // Review events — quote the feedback
  if (event.type === 'coord.review.completed') {
    const review = payload as unknown as CoordReviewPayload;
    if (review.feedback) {
      lines.push('', `> ${review.feedback}`);
    }
  }

  return lines.join('\n');
}

function describeAction(event: YClawEvent<unknown>): string {
  const payload = event.payload as Record<string, unknown>;
  const desc = (payload.description as string) || '';

  switch (event.type) {
    case 'coord.deliverable.submitted':
      return `submitted deliverable \u2014 ${desc || (payload.artifact_type as string) || 'artifact'}`;
    case 'coord.deliverable.approved':
      return 'approved deliverable';
    case 'coord.deliverable.changes_requested':
      return 'requested changes on deliverable';
    case 'coord.review.completed': {
      const status = (payload as unknown as CoordReviewPayload).status;
      return status === 'approved' ? 'approved review' : `review \u2014 ${status}`;
    }
    case 'coord.task.blocked':
      return `task blocked \u2014 ${desc || 'awaiting resolution'}`;
    case 'coord.task.completed':
      return `completed task \u2014 ${desc || 'done'}`;
    case 'coord.task.failed':
      return `task failed \u2014 ${(payload.message as string) || desc || 'error'}`;
    case 'coord.project.kicked_off':
      return 'kicked off project';
    case 'coord.project.phase_completed':
      return `completed phase \u2014 ${(payload as unknown as CoordProjectPayload).phase || ''}`;
    case 'coord.project.completed':
      return 'completed project';
    default:
      return event.type.split('.').pop() || 'event';
  }
}
