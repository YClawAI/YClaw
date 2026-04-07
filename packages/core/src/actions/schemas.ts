/**
 * Typed parameter schemas for action tools.
 *
 * Each entry maps an action name to its parameter schema.
 * When an action has a schema here, the LLM sees typed parameters
 * instead of a generic `params: object`. This dramatically improves
 * the LLM's ability to call actions correctly.
 *
 * Architecture: GitHub, Slack, Event, Twitter, X Search, and Telegram
 * schemas are implemented.
 */

import type { ToolParameter } from '../config/schema.js';
import { DEPLOY_SCHEMAS } from './deploy/schemas.js';

// ─── Defaults ────────────────────────────────────────────────────────────────

const GITHUB_DEFAULTS = {
  owner: 'yclaw-ai',
  repo: 'yclaw',
} as const;

const TELEGRAM_PARSE_MODE_DESC =
  'Message parse mode: "HTML", "Markdown", or "MarkdownV2" (optional)';

// ─── GitHub Action Schemas ───────────────────────────────────────────────────

const GITHUB_SCHEMAS: Record<string, { description: string; parameters: Record<string, ToolParameter> }> = {
  'github:get_contents': {
    description: 'Get file or directory contents from a GitHub repository',
    parameters: {
      owner: { type: 'string', description: `Repository owner (default: ${GITHUB_DEFAULTS.owner})` },
      repo: { type: 'string', description: `Repository name (default: ${GITHUB_DEFAULTS.repo})` },
      path: { type: 'string', description: 'File or directory path (no leading slash)', required: true },
      ref: { type: 'string', description: 'Git ref — branch, tag, or SHA (default: master)' },
    },
  },

  'github:commit_file': {
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

  'github:create_branch': {
    description: 'Create a new branch from an existing ref',
    parameters: {
      owner: { type: 'string', description: `Repository owner (default: ${GITHUB_DEFAULTS.owner})` },
      repo: { type: 'string', description: `Repository name (default: ${GITHUB_DEFAULTS.repo})` },
      branch: { type: 'string', description: 'New branch name (e.g., feature/add-caching)', required: true },
      from_ref: { type: 'string', description: 'Source ref to branch from (default: master)' },
    },
  },

  'github:create_pr': {
    description: 'Create a pull request. Pass closes_issues to auto-link and auto-close GitHub issues on merge.',
    parameters: {
      owner: { type: 'string', description: `Repository owner (default: ${GITHUB_DEFAULTS.owner})` },
      repo: { type: 'string', description: `Repository name (default: ${GITHUB_DEFAULTS.repo})` },
      title: { type: 'string', description: 'PR title', required: true },
      body: { type: 'string', description: 'PR description (markdown)' },
      head: { type: 'string', description: 'Source branch (the branch with changes)', required: true },
      base: { type: 'string', description: 'Target branch to merge into (default: master)' },
      closes_issues: { type: 'array', items: { type: 'number', description: 'GitHub issue number' }, description: 'Issue numbers this PR fixes. Auto-appends "Closes #NNN" to body.' },
    },
  },

  'github:merge_pr': {
    description: 'Merge a pull request',
    parameters: {
      owner: { type: 'string', description: `Repository owner (default: ${GITHUB_DEFAULTS.owner})` },
      repo: { type: 'string', description: `Repository name (default: ${GITHUB_DEFAULTS.repo})` },
      pullNumber: { type: 'number', description: 'Pull request number', required: true },
      commit_title: { type: 'string', description: 'Custom merge commit title' },
      merge_method: { type: 'string', description: 'Merge method: merge, squash, or rebase (default: squash)' },
    },
  },

  'github:close_issue': {
    description: 'Close a GitHub issue with optional comment',
    parameters: {
      owner: { type: 'string', description: `Repository owner (default: ${GITHUB_DEFAULTS.owner})` },
      repo: { type: 'string', description: `Repository name (default: ${GITHUB_DEFAULTS.repo})` },
      issue_number: { type: 'number', description: 'Issue number to close', required: true },
      comment: { type: 'string', description: 'Optional comment to add before closing' },
    },
  },

  'github:pr_review': {
    description: 'Submit a review on a pull request (approve, request changes, or comment)',
    parameters: {
      owner: { type: 'string', description: `Repository owner (default: ${GITHUB_DEFAULTS.owner})` },
      repo: { type: 'string', description: `Repository name (default: ${GITHUB_DEFAULTS.repo})` },
      pullNumber: { type: 'number', description: 'Pull request number', required: true },
      event: { type: 'string', description: 'Review action: APPROVE, REQUEST_CHANGES, or COMMENT', required: true },
      body: { type: 'string', description: 'Review body text (required for REQUEST_CHANGES)' },
    },
  },

  'github:pr_comment': {
    description: 'Add a comment on a pull request',
    parameters: {
      owner: { type: 'string', description: `Repository owner (default: ${GITHUB_DEFAULTS.owner})` },
      repo: { type: 'string', description: `Repository name (default: ${GITHUB_DEFAULTS.repo})` },
      pullNumber: { type: 'number', description: 'Pull request number', required: true },
      body: { type: 'string', description: 'Comment body (markdown)', required: true },
    },
  },

  'github:get_diff': {
    description: 'Get the diff of a pull request for code review',
    parameters: {
      owner: { type: 'string', description: `Repository owner (default: ${GITHUB_DEFAULTS.owner})` },
      repo: { type: 'string', description: `Repository name (default: ${GITHUB_DEFAULTS.repo})` },
      pullNumber: { type: 'number', description: 'Pull request number', required: true },
    },
  },

  'github:compare_commits': {
    description: 'Compare two commits in a GitHub repository and return the list of changed files with their status (added/modified/removed), additions, and deletions. Useful for determining what changed in a deployment.',
    parameters: {
      owner: { type: 'string', description: `Repository owner (default: ${GITHUB_DEFAULTS.owner})` },
      repo: { type: 'string', description: `Repository name (default: ${GITHUB_DEFAULTS.repo})` },
      base: { type: 'string', description: 'Base ref (branch, tag, or SHA) — the starting point of the comparison', required: true },
      head: { type: 'string', description: 'Head ref (branch, tag, or SHA) — the ending point of the comparison', required: true },
    },
  },

  'github:create_issue': {
    description: 'Create a new issue',
    parameters: {
      owner: { type: 'string', description: `Repository owner (default: ${GITHUB_DEFAULTS.owner})` },
      repo: { type: 'string', description: `Repository name (default: ${GITHUB_DEFAULTS.repo})` },
      title: { type: 'string', description: 'Issue title', required: true },
      body: { type: 'string', description: 'Issue body (markdown)' },
      labels: { type: 'string', description: 'Comma-separated label names' },
    },
  },

  'github:get_issue': {
    description: 'Get a single issue by number',
    parameters: {
      owner: { type: 'string', description: `Repository owner (default: ${GITHUB_DEFAULTS.owner})` },
      repo: { type: 'string', description: `Repository name (default: ${GITHUB_DEFAULTS.repo})` },
      issue_number: { type: 'number', description: 'Issue number to retrieve', required: true },
    },
  },

  'github:list_issues': {
    description: 'List issues in a repository with optional filters',
    parameters: {
      owner: { type: 'string', description: `Repository owner (default: ${GITHUB_DEFAULTS.owner})` },
      repo: { type: 'string', description: `Repository name (default: ${GITHUB_DEFAULTS.repo})` },
      state: { type: 'string', description: 'Issue state filter: open, closed, or all (default: open)' },
      labels: { type: 'string', description: 'Comma-separated label names to filter by' },
      per_page: { type: 'number', description: 'Results per page (default: 30, max: 100)' },
      page: { type: 'number', description: 'Page number (default: 1)' },
    },
  },
};

// ─── Slack Action Schemas ────────────────────────────────────────────────────

const SLACK_SCHEMAS: Record<string, { description: string; parameters: Record<string, ToolParameter> }> = {
  'slack:message': {
    description: 'Post a message to a Slack channel',
    parameters: {
      channel: { type: 'string', description: 'Channel name or ID (e.g., "#yclaw-development")', required: true },
      text: { type: 'string', description: 'Message text content', required: true },
      thread_ts: { type: 'string', description: 'Thread timestamp to reply in a thread (optional)' },
      username: { type: 'string', description: 'Display name override (requires chat:write.customize scope)' },
      icon_emoji: { type: 'string', description: 'Emoji icon override (e.g., ":hammer:")' },
      blocks: { type: 'object', description: 'Slack Block Kit blocks array for rich message formatting' },
    },
  },

  'slack:thread_reply': {
    description: 'Reply to an existing message thread in Slack',
    parameters: {
      channel: { type: 'string', description: 'Channel name or ID where the thread exists', required: true },
      threadTs: { type: 'string', description: 'Timestamp of the parent message to reply to', required: true },
      text: { type: 'string', description: 'Reply text content', required: true },
      username: { type: 'string', description: 'Display name override (requires chat:write.customize scope)' },
      icon_emoji: { type: 'string', description: 'Emoji icon override (e.g., ":hammer:")' },
      blocks: { type: 'object', description: 'Slack Block Kit blocks array for rich message formatting' },
    },
  },

  'slack:get_channel_history': {
    description: 'Get recent messages from a Slack channel. Channel names are auto-resolved to IDs. Limit is clamped to 1-200.',
    parameters: {
      channel: { type: 'string', description: 'Channel name or ID (e.g., "#yclaw-development" or "C01234ABCDE")', required: true },
      limit: { type: 'number', description: 'Number of messages to retrieve (default: 50, max: 200)' },
    },
  },

  'slack:get_thread': {
    description: 'Get all replies in a Slack thread. Channel names are auto-resolved to IDs.',
    parameters: {
      channel: { type: 'string', description: 'Channel name or ID where the thread exists (e.g., "#yclaw-development" or "C01234ABCDE")', required: true },
      thread_ts: { type: 'string', description: 'Timestamp of the parent message', required: true },
    },
  },

  'slack:alert': {
    description: 'Post a message with alert formatting (colored sidebar) to a Slack channel',
    parameters: {
      channel: { type: 'string', description: 'Channel name or ID (e.g., "#yclaw-alerts")', required: true },
      text: { type: 'string', description: 'Alert message text', required: true },
      severity: { type: 'string', description: 'Alert severity: info, warning, error, critical, or success (default: warning)' },
      title: { type: 'string', description: 'Alert title (optional, defaults to severity-based title)' },
      username: { type: 'string', description: 'Display name override (requires chat:write.customize scope)' },
      icon_emoji: { type: 'string', description: 'Emoji icon override (e.g., ":rotating_light:")' },
    },
  },

  'slack:dm': {
    description: 'Send a direct message to a Slack user',
    parameters: {
      userId: { type: 'string', description: 'Slack user ID to send the DM to', required: true },
      text: { type: 'string', description: 'Message text content', required: true },
      blocks: { type: 'object', description: 'Slack Block Kit blocks array for rich message formatting' },
    },
  },
};

// ─── Event Action Schemas ────────────────────────────────────────────────────

const EVENT_SCHEMAS: Record<string, { description: string; parameters: Record<string, ToolParameter> }> = {
  'event:publish': {
    description: 'Publish an event to the internal event bus for inter-agent communication',
    parameters: {
      source: { type: 'string', description: 'Agent name that is emitting the event (e.g., "builder")', required: true },
      type: { type: 'string', description: 'Event type identifier (e.g., "pr_ready", "standup_report")', required: true },
      payload: {
        type: 'object',
        description: 'Event payload — arbitrary data relevant to the event type',
        required: true,
      },
      correlationId: {
        type: 'string',
        description: 'Correlation ID inherited from the triggering event. Propagate this to maintain end-to-end pipeline traceability.',
      },
    },
  },
};

// ─── Repo Action Schemas ─────────────────────────────────────────────────────

const REPO_SCHEMAS: Record<string, { description: string; parameters: Record<string, ToolParameter> }> = {
  'repo:list': {
    description: 'List repositories in the organization',
    parameters: {},
  },
};

// ─── Twitter Action Schemas (Write Operations) ──────────────────────────────

const TWITTER_SCHEMAS: Record<string, { description: string; parameters: Record<string, ToolParameter> }> = {
  'twitter:post': {
    description: 'Post a single tweet',
    parameters: {
      text: { type: 'string', description: 'Tweet text content (max 280 characters)', required: true },
    },
  },

  'twitter:thread': {
    description: 'Post a thread of tweets (array of tweets posted sequentially with 1s delay between each)',
    parameters: {
      tweets: {
        type: 'array',
        description: 'Array of tweet text strings to post as a thread (each max 280 characters)',
        required: true,
        items: { type: 'string', description: 'Individual tweet text' },
      },
    },
  },

  'twitter:reply': {
    description: 'Reply to a specific tweet',
    parameters: {
      tweetId: { type: 'string', description: 'ID of the tweet to reply to', required: true },
      text: { type: 'string', description: 'Reply text content (max 280 characters)', required: true },
    },
  },

  'twitter:like': {
    description: 'Like a tweet',
    parameters: {
      tweetId: { type: 'string', description: 'ID of the tweet to like', required: true },
    },
  },

  'twitter:retweet': {
    description: 'Retweet a tweet',
    parameters: {
      tweetId: { type: 'string', description: 'ID of the tweet to retweet', required: true },
    },
  },

  'twitter:follow': {
    description: 'Follow a Twitter/X user by their user ID',
    parameters: {
      targetUserId: { type: 'string', description: 'Twitter user ID of the account to follow', required: true },
    },
  },

  'twitter:dm': {
    description: 'Send a direct message to a Twitter/X user',
    parameters: {
      participantId: { type: 'string', description: 'Twitter user ID or conversation ID of the DM recipient', required: true },
      text: { type: 'string', description: 'DM text content', required: true },
    },
  },

  'twitter:media_upload': {
    description: 'Upload media (image) and optionally post a tweet with it. Provide either mediaData (base64) or mediaPath.',
    parameters: {
      text: { type: 'string', description: 'Tweet text to post with the media (optional — omit to upload without tweeting)' },
      mediaData: { type: 'string', description: 'Base64-encoded image data (provide this or mediaPath)' },
      mediaPath: { type: 'string', description: 'File path to the image (provide this or mediaData)' },
    },
  },

  'twitter:update_profile': {
    description: 'Update Twitter/X profile fields (name, bio, url, location). Provide at least one field.',
    parameters: {
      name: { type: 'string', description: 'Display name' },
      description: { type: 'string', description: 'Bio / profile description' },
      url: { type: 'string', description: 'Profile website URL' },
      location: { type: 'string', description: 'Profile location text' },
    },
  },

  'twitter:update_profile_image': {
    description: 'Update Twitter/X profile picture',
    parameters: {
      image: { type: 'string', description: 'Base64-encoded PNG image data for the profile picture', required: true },
    },
  },

  'twitter:update_profile_banner': {
    description: 'Update Twitter/X profile banner image',
    parameters: {
      banner: { type: 'string', description: 'Base64-encoded PNG image data for the banner (recommended 1500x500)', required: true },
    },
  },

  'twitter:read_metrics': {
    description: 'Read public engagement metrics (likes, retweets, replies, views) for one or more tweets',
    parameters: {
      tweetId: { type: 'string', description: 'Single tweet ID to read metrics for (use this or tweetIds)' },
      tweetIds: {
        type: 'array',
        description: 'Array of tweet IDs to read metrics for (use this or tweetId)',
        items: { type: 'string', description: 'Tweet ID' },
      },
    },
  },
};

// ─── X Search Action Schemas (Read Operations) ──────────────────────────────

const X_SEARCH_SCHEMAS: Record<string, { description: string; parameters: Record<string, ToolParameter> }> = {
  'x:search': {
    description: 'Search tweets by query string. Auto-escalates through tiers: TwitterAPI.io → Official X API → xAI Grok.',
    parameters: {
      query: { type: 'string', description: 'Search query string (supports Twitter search operators)', required: true },
      queryType: { type: 'string', description: 'Search type: "Latest" or "Top" (default: Latest)' },
      cursor: { type: 'string', description: 'Pagination cursor from a previous search result' },
    },
  },

  'x:lookup': {
    description: 'Look up a single tweet by ID or URL. Auto-escalates through tiers: FxTwitter → Official X API → xAI Grok.',
    parameters: {
      tweetId: { type: 'string', description: 'Tweet ID to look up (provide this or url)' },
      url: { type: 'string', description: 'Full tweet URL (e.g., "https://x.com/user/status/123456")' },
    },
  },

  'x:user': {
    description: 'Look up a Twitter/X user profile by username. Auto-escalates through tiers: FxTwitter → TwitterAPI.io → Official X API → xAI Grok.',
    parameters: {
      username: { type: 'string', description: 'Twitter username (with or without @ prefix)', required: true },
    },
  },

  'x:user_tweets': {
    description: 'Get recent tweets from a specific user. Auto-escalates through tiers: TwitterAPI.io → Official X API → xAI Grok.',
    parameters: {
      username: { type: 'string', description: 'Twitter username (with or without @ prefix)', required: true },
      cursor: { type: 'string', description: 'Pagination cursor from a previous result' },
    },
  },
};

// ─── Telegram Action Schemas ─────────────────────────────────────────────────

const TELEGRAM_SCHEMAS: Record<string, { description: string; parameters: Record<string, ToolParameter> }> = {
  'telegram:message': {
    description: 'Send a message to a Telegram channel or group',
    parameters: {
      chatId: { type: 'string', description: 'Chat ID or @channel username to send the message to', required: true },
      text: { type: 'string', description: 'Message text content', required: true },
      parseMode: { type: 'string', description: TELEGRAM_PARSE_MODE_DESC },
    },
  },

  'telegram:reply': {
    description: 'Reply to a specific message in a Telegram chat',
    parameters: {
      chatId: { type: 'string', description: 'Chat ID or @channel username', required: true },
      text: { type: 'string', description: 'Reply text content', required: true },
      replyToMessageId: { type: 'number', description: 'Message ID to reply to', required: true },
      parseMode: { type: 'string', description: TELEGRAM_PARSE_MODE_DESC },
    },
  },

  'telegram:pin': {
    description: 'Pin a message in a Telegram chat',
    parameters: {
      chatId: { type: 'string', description: 'Chat ID or @channel username', required: true },
      messageId: { type: 'number', description: 'ID of the message to pin', required: true },
      disableNotification: { type: 'boolean', description: 'Suppress pin notification to members (default: false)' },
    },
  },

  'telegram:delete': {
    description: 'Delete a message from a Telegram chat',
    parameters: {
      chatId: { type: 'string', description: 'Chat ID or @channel username', required: true },
      messageId: { type: 'number', description: 'ID of the message to delete', required: true },
    },
  },

  'telegram:dm': {
    description: 'Send a direct message to a Telegram user (user must have started the bot first)',
    parameters: {
      userId: { type: 'string', description: 'Telegram user ID to send the DM to', required: true },
      text: { type: 'string', description: 'Message text content', required: true },
      parseMode: { type: 'string', description: TELEGRAM_PARSE_MODE_DESC },
    },
  },

  'telegram:announce': {
    description: 'Post to the announcement channel (uses TELEGRAM_ANNOUNCEMENT_CHAT_ID or TELEGRAM_CHAT_ID env var)',
    parameters: {
      text: { type: 'string', description: 'Announcement text content', required: true },
      parseMode: { type: 'string', description: `${TELEGRAM_PARSE_MODE_DESC} (default: HTML)` },
    },
  },

  'telegram:ban': {
    description: 'Ban a user from a Telegram chat',
    parameters: {
      chatId: { type: 'string', description: 'Chat ID or @channel username', required: true },
      userId: { type: 'number', description: 'Telegram user ID to ban', required: true },
      untilDate: { type: 'number', description: 'Unix timestamp when the ban expires (0 or omit for permanent)' },
    },
  },

  'telegram:restrict': {
    description: 'Restrict a user\'s permissions in a Telegram chat (default: mute all)',
    parameters: {
      chatId: { type: 'string', description: 'Chat ID or @channel username', required: true },
      userId: { type: 'number', description: 'Telegram user ID to restrict', required: true },
      permissions: {
        type: 'object',
        description: 'Permission overrides — keys: can_send_messages, can_send_audios, can_send_documents, can_send_photos, can_send_videos, can_send_video_notes, can_send_voice_notes, can_send_polls, can_send_other_messages, can_add_web_page_previews (all default to false)',
      },
      untilDate: { type: 'number', description: 'Unix timestamp when restrictions expire (0 or omit for permanent)' },
    },
  },

  'telegram:set_chat_photo': {
    description: 'Update a Telegram chat\'s photo',
    parameters: {
      chatId: { type: 'string', description: 'Chat ID or @channel username', required: true },
      photoPath: { type: 'string', description: 'File path to the photo image', required: true },
    },
  },

  'telegram:set_title': {
    description: 'Update a Telegram chat\'s title',
    parameters: {
      chatId: { type: 'string', description: 'Chat ID or @channel username', required: true },
      title: { type: 'string', description: 'New chat title', required: true },
    },
  },

  'telegram:set_description': {
    description: 'Update a Telegram chat\'s description',
    parameters: {
      chatId: { type: 'string', description: 'Chat ID or @channel username', required: true },
      description: { type: 'string', description: 'New chat description (can be empty string to clear)', required: true },
    },
  },

  'telegram:set_permissions': {
    description: 'Set default chat permissions for all members in a Telegram chat',
    parameters: {
      chatId: { type: 'string', description: 'Chat ID or @channel username', required: true },
      permissions: {
        type: 'object',
        description: 'Default permissions object — keys: can_send_messages, can_send_audios, can_send_documents, can_send_photos, can_send_videos, can_send_video_notes, can_send_voice_notes, can_send_polls, can_send_other_messages, can_add_web_page_previews, can_change_info, can_invite_users, can_pin_messages, can_manage_topics',
        required: true,
      },
    },
  },

  'telegram:export_invite': {
    description: 'Export or create an invite link for a Telegram chat',
    parameters: {
      chatId: { type: 'string', description: 'Chat ID or @channel username', required: true },
    },
  },
};

// ─── Task Registry Schemas ───────────────────────────────────────────────────

const TASK_SCHEMAS: Record<string, { description: string; parameters: Record<string, ToolParameter> }> = {
  'task:create': {
    description: 'Create a new task record in the task registry. Called by Strategist when dispatching work to an agent.',
    parameters: {
      agent: { type: 'string', description: 'Agent name that will execute this task (e.g., "builder")', required: true },
      task: { type: 'string', description: 'Task name matching the agent\'s workflow (e.g., "implement_issue")', required: true },
      priority: { type: 'string', description: 'Task priority: P0 (critical), P1 (high), P2 (normal). Default: P2' },
      issueNumber: { type: 'number', description: 'GitHub issue number this task relates to (if applicable)' },
      prNumber: { type: 'number', description: 'Pull request number this task relates to (if applicable)' },
    },
  },

  'task:update': {
    description: 'Update a task record status or metadata. Called by agents as work progresses.',
    parameters: {
      id: { type: 'string', description: 'Task ID to update', required: true },
      status: { type: 'string', description: 'New status: pending, in_progress, completed, failed, or stuck' },
      prNumber: { type: 'number', description: 'Pull request number to associate with this task' },
      reviewStatus: { type: 'string', description: 'PR review status: pending, approved, or changes_requested' },
    },
  },

  'task:query': {
    description: 'Query task status by ID or agent name. Returns task records with stuck detection.',
    parameters: {
      id: { type: 'string', description: 'Task ID to look up (returns single record)' },
      agent: { type: 'string', description: 'Agent name to query all tasks for (returns array)' },
      status: { type: 'string', description: 'Filter by status when querying by agent' },
    },
  },

  'task:summary': {
    description: 'Get a one-line status summary for all agents in a single call. Returns counts of pending/in_progress/stuck/completed/failed tasks per agent. Use this instead of querying each agent individually.',
    parameters: {},
  },
};


// ─── Combined Registry ──────────────────────────────────────────────────────

export const ACTION_SCHEMAS: Record<string, { description: string; parameters: Record<string, ToolParameter> }> = {
  ...GITHUB_SCHEMAS,
  ...SLACK_SCHEMAS,
  ...EVENT_SCHEMAS,
  ...REPO_SCHEMAS,
  ...TWITTER_SCHEMAS,
  ...X_SEARCH_SCHEMAS,
  ...TELEGRAM_SCHEMAS,
  ...TASK_SCHEMAS,
  ...DEPLOY_SCHEMAS,
};

/**
 * Get the default values for an action's parameters.
 * Used to inject defaults before passing to the executor.
 */
export const ACTION_DEFAULTS: Record<string, Record<string, unknown>> = {
  // GitHub defaults
  'github:get_contents': GITHUB_DEFAULTS,
  'github:commit_file': GITHUB_DEFAULTS,
  'github:create_branch': GITHUB_DEFAULTS,
  'github:create_pr': { ...GITHUB_DEFAULTS, base: 'master' },
  'github:merge_pr': { ...GITHUB_DEFAULTS, merge_method: 'squash' },
  'github:pr_review': GITHUB_DEFAULTS,
  'github:pr_comment': GITHUB_DEFAULTS,
  'github:get_diff': GITHUB_DEFAULTS,
  'github:compare_commits': GITHUB_DEFAULTS,
  'github:create_issue': GITHUB_DEFAULTS,
  'github:get_issue': GITHUB_DEFAULTS,
  'github:list_issues': { ...GITHUB_DEFAULTS, state: 'open', per_page: 30, page: 1 },
  // Slack defaults
  'slack:get_channel_history': { limit: 50 },
  // X Search defaults
  'x:search': { queryType: 'Latest' },
  // Telegram defaults
  'telegram:announce': { parseMode: 'HTML' },
  'telegram:pin': { disableNotification: false },
};
