import { TwitterApi } from 'twitter-api-v2';
import type { ActionResult, ActionExecutor } from './types.js';
import type { ToolDefinition } from '../config/schema.js';
import { createLogger } from '../logging/logger.js';
import {
  tier1LookupTweet,
  tier1LookupUser,
  tier2Search,
  tier2UserInfo,
  tier2UserTweets,
  tier3Search,
  tier3LookupTweet,
  tier3LookupUser,
  tier3UserTweets,
  xaiSearch,
  extractTweetId,
  normalizeUsername,
} from './x-search-tiers.js';

const logger = createLogger('x-search-executor');

// ─── X / Twitter Search Executor (Read-Only, Tiered) ──────────────────────────
//
// Tiered auto-escalating search across 4 providers:
//   Tier 1: FxTwitter    (free, no auth)      — tweet lookup, user profile
//   Tier 2: TwitterAPI.io ($0.15/1K)          — search, user info, user tweets
//   Tier 3: Official X API v2 ($0.005/read)   — full search, lookup, timeline
//   Tier 4: xAI Grok x_search (fallback)      — LLM-mediated X search via Responses API
//
// Actions:
//   x:search       - Search tweets by query string        (Tier 2 → 3 → 4)
//   x:lookup       - Look up tweet by ID or URL           (Tier 1 → 3 → 4)
//   x:user         - Look up user profile by username     (Tier 1 → 2 → 3 → 4)
//   x:user_tweets  - Get recent tweets from a user        (Tier 2 → 3 → 4)
//

export class XSearchExecutor implements ActionExecutor {
  readonly name = 'x';

  private twitterApiIoKey: string | null;
  private officialClient: TwitterApi | null = null;
  private xaiApiKey: string | null;

  constructor() {
    this.twitterApiIoKey = process.env.TWITTERAPI_IO_KEY || null;
    if (!this.twitterApiIoKey) {
      logger.warn('TWITTERAPI_IO_KEY not set — Tier 2 (TwitterAPI.io) unavailable');
    }

    const appKey = process.env.TWITTER_APP_KEY;
    const appSecret = process.env.TWITTER_APP_SECRET;
    const accessToken = process.env.TWITTER_ACCESS_TOKEN;
    const accessSecret = process.env.TWITTER_ACCESS_SECRET;

    if (appKey && appSecret && accessToken && accessSecret) {
      this.officialClient = new TwitterApi({ appKey, appSecret, accessToken, accessSecret });
    } else {
      logger.warn('Twitter OAuth credentials not fully configured — Tier 3 (Official X API) unavailable');
    }

    this.xaiApiKey = process.env.XAI_API_KEY || null;
    if (!this.xaiApiKey) {
      logger.warn('XAI_API_KEY not set — Tier 4 (xAI Grok x_search) unavailable');
    }
  }

  getToolDefinitions(): ToolDefinition[] {
    return [
      {
        name: 'x:search',
        description: 'Search tweets by query string. Auto-escalates through tiers: TwitterAPI.io → Official X API → xAI Grok.',
        parameters: {
          query: { type: 'string', description: 'Search query string (supports Twitter search operators)', required: true },
          queryType: { type: 'string', description: 'Search type: "Latest" or "Top" (default: Latest)' },
          cursor: { type: 'string', description: 'Pagination cursor from a previous search result' },
        },
      },
      {
        name: 'x:lookup',
        description: 'Look up a tweet by ID or URL. Auto-escalates through tiers: FxTwitter → Official X API → xAI Grok.',
        parameters: {
          tweetId: { type: 'string', description: 'Tweet ID to look up (provide this or url)' },
          url: { type: 'string', description: 'Full tweet URL (provide this or tweetId)' },
        },
      },
      {
        name: 'x:user',
        description: 'Look up a user profile by username. Auto-escalates through tiers: FxTwitter → TwitterAPI.io → Official X API → xAI Grok.',
        parameters: {
          username: { type: 'string', description: 'Twitter/X username (with or without @)', required: true },
        },
      },
      {
        name: 'x:user_tweets',
        description: 'Get recent tweets from a user. Auto-escalates through tiers: TwitterAPI.io → Official X API → xAI Grok.',
        parameters: {
          username: { type: 'string', description: 'Twitter/X username (with or without @)', required: true },
          cursor: { type: 'string', description: 'Pagination cursor from a previous result' },
        },
      },
    ];
  }

  async execute(action: string, params: Record<string, unknown>): Promise<ActionResult> {
    switch (action) {
      case 'search':
        return this.searchWithEscalation(params);
      case 'lookup':
        return this.lookupWithEscalation(params);
      case 'user':
        return this.userWithEscalation(params);
      case 'user_tweets':
        return this.userTweetsWithEscalation(params);
      default:
        return { success: false, error: `Unknown X search action: ${action}` };
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      const res = await fetch('https://api.fxtwitter.com/i/status/1');
      return res.ok || res.status === 404;
    } catch {
      return false;
    }
  }

  // ─── Escalation Strategies ──────────────────────────────────────────────────

  private async searchWithEscalation(params: Record<string, unknown>): Promise<ActionResult> {
    const query = params.query as string | undefined;
    if (!query) return { success: false, error: 'Missing required parameter: query' };
    const queryType = (params.queryType as string) || 'Latest';
    const cursor = params.cursor as string | undefined;

    if (this.twitterApiIoKey) {
      const result = await tier2Search(this.twitterApiIoKey, query, queryType, cursor);
      if (result.success) return result;
      logger.warn('Tier 2 (TwitterAPI.io) search failed, escalating to Tier 3', { error: result.error });
    }

    if (this.officialClient) {
      const result = await tier3Search(this.officialClient, query);
      if (result.success) return result;
      logger.warn('Tier 3 (Official X API) search failed, escalating to Tier 4', { error: result.error });
    }

    if (this.xaiApiKey) {
      return xaiSearch(this.xaiApiKey, query);
    }

    return { success: false, error: 'All X search tiers exhausted. Configure TWITTERAPI_IO_KEY, TWITTER_APP_KEY, or XAI_API_KEY.' };
  }

  private async lookupWithEscalation(params: Record<string, unknown>): Promise<ActionResult> {
    const tweetId = extractTweetId(params);
    if (!tweetId) return { success: false, error: 'Missing required parameter: tweetId or url' };

    const result = await tier1LookupTweet(tweetId);
    if (result.success) return result;
    logger.warn('Tier 1 (FxTwitter) lookup failed, escalating to Tier 3', { error: result.error });

    if (this.officialClient) {
      const t3 = await tier3LookupTweet(this.officialClient, tweetId);
      if (t3.success) return t3;
      logger.warn('Tier 3 (Official X API) lookup failed, escalating to Tier 4', { error: t3.error });
    }

    if (this.xaiApiKey) {
      return xaiSearch(this.xaiApiKey, `tweet id:${tweetId}`);
    }

    return { success: false, error: `Failed to look up tweet ${tweetId}. All tiers exhausted.` };
  }

  private async userWithEscalation(params: Record<string, unknown>): Promise<ActionResult> {
    const username = normalizeUsername(params.username as string | undefined);
    if (!username) return { success: false, error: 'Missing required parameter: username' };

    const t1 = await tier1LookupUser(username);
    if (t1.success) return t1;
    logger.warn('Tier 1 (FxTwitter) user lookup failed, escalating to Tier 2', { error: t1.error });

    if (this.twitterApiIoKey) {
      const t2 = await tier2UserInfo(this.twitterApiIoKey, username);
      if (t2.success) return t2;
      logger.warn('Tier 2 (TwitterAPI.io) user lookup failed, escalating to Tier 3', { error: t2.error });
    }

    if (this.officialClient) {
      const t3 = await tier3LookupUser(this.officialClient, username);
      if (t3.success) return t3;
      logger.warn('Tier 3 (Official X API) user lookup failed, escalating to Tier 4', { error: t3.error });
    }

    if (this.xaiApiKey) {
      return xaiSearch(this.xaiApiKey, `user profile @${username}`);
    }

    return { success: false, error: `Failed to look up user @${username}. All tiers exhausted.` };
  }

  private async userTweetsWithEscalation(params: Record<string, unknown>): Promise<ActionResult> {
    const username = normalizeUsername(params.username as string | undefined);
    if (!username) return { success: false, error: 'Missing required parameter: username' };
    const cursor = params.cursor as string | undefined;

    if (this.twitterApiIoKey) {
      const result = await tier2UserTweets(this.twitterApiIoKey, username, cursor);
      if (result.success) return result;
      logger.warn('Tier 2 (TwitterAPI.io) user tweets failed, escalating to Tier 3', { error: result.error });
    }

    if (this.officialClient) {
      const result = await tier3UserTweets(this.officialClient, username);
      if (result.success) return result;
      logger.warn('Tier 3 (Official X API) user tweets failed, escalating to Tier 4', { error: result.error });
    }

    if (this.xaiApiKey) {
      return xaiSearch(this.xaiApiKey, `recent tweets from @${username}`);
    }

    return { success: false, error: 'All tiers exhausted for user tweets. Configure TWITTERAPI_IO_KEY, TWITTER_APP_KEY, or XAI_API_KEY.' };
  }
}
