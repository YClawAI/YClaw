import type { TwitterApi } from 'twitter-api-v2';
import type { ActionResult } from './types.js';
import { createLogger } from '../logging/logger.js';

const logger = createLogger('x-search-tiers');

// ─── Shared Types ──────────────────────────────────────────────────────────────

export interface NormalizedTweet {
  id: string;
  text: string;
  author: { username: string; name: string; verified: boolean };
  metrics: { likes: number; retweets: number; replies: number; views?: number };
  created_at: string;
  url: string;
}

export interface XSearchResult {
  tweets: NormalizedTweet[];
  tier_used: number;
  has_more: boolean;
  cursor?: string;
}

export interface XUserResult {
  id: string;
  username: string;
  name: string;
  description: string;
  verified: boolean;
  followers: number;
  following: number;
  tweet_count: number;
  profile_image_url?: string;
  url?: string;
  tier_used: number;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Tier 1 — FxTwitter (free, no auth)
// ═══════════════════════════════════════════════════════════════════════════════

export async function tier1LookupTweet(tweetId: string): Promise<ActionResult> {
  try {
    const res = await fetch(`https://api.fxtwitter.com/i/status/${tweetId}`);
    if (!res.ok) {
      return { success: false, error: `FxTwitter returned ${res.status}` };
    }
    const json = await res.json() as Record<string, unknown>;
    if (json.code !== 200) {
      return { success: false, error: `FxTwitter error: ${json.message}` };
    }

    const tweet = json.tweet as Record<string, unknown>;
    const author = tweet.author as Record<string, unknown>;
    const normalized: NormalizedTweet = {
      id: String(tweet.id),
      text: String(tweet.text),
      author: {
        username: String(author.screen_name || author.username || ''),
        name: String(author.name || ''),
        verified: Boolean(author.verified),
      },
      metrics: {
        likes: Number(tweet.likes || 0),
        retweets: Number(tweet.retweets || 0),
        replies: Number(tweet.replies || 0),
        views: tweet.views ? Number(tweet.views) : undefined,
      },
      created_at: String(tweet.created_at || ''),
      url: String(tweet.url || `https://x.com/i/status/${tweetId}`),
    };

    const result: XSearchResult = { tweets: [normalized], tier_used: 1, has_more: false };
    logger.info('Tier 1 tweet lookup successful', { tweetId });
    return { success: true, data: result as unknown as Record<string, unknown> };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Tier 1 lookup failed: ${msg}` };
  }
}

export async function tier1LookupUser(username: string): Promise<ActionResult> {
  try {
    const res = await fetch(`https://api.fxtwitter.com/${username}`);
    if (!res.ok) {
      return { success: false, error: `FxTwitter returned ${res.status}` };
    }
    const json = await res.json() as Record<string, unknown>;
    if (json.code !== 200) {
      return { success: false, error: `FxTwitter error: ${json.message}` };
    }

    const user = json.user as Record<string, unknown>;
    const result: XUserResult = {
      id: String(user.id || ''),
      username: String(user.screen_name || user.username || username),
      name: String(user.name || ''),
      description: String(user.description || ''),
      verified: Boolean(user.verified),
      followers: Number(user.followers || user.followers_count || 0),
      following: Number(user.following || user.friends_count || 0),
      tweet_count: Number(user.tweets || user.statuses_count || 0),
      profile_image_url: user.avatar_url ? String(user.avatar_url) : undefined,
      url: user.url ? String(user.url) : undefined,
      tier_used: 1,
    };

    logger.info('Tier 1 user lookup successful', { username });
    return { success: true, data: result as unknown as Record<string, unknown> };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Tier 1 user lookup failed: ${msg}` };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Tier 2 — TwitterAPI.io ($0.15/1K tweets)
// ═══════════════════════════════════════════════════════════════════════════════

function normalizeTier2Tweet(t: Record<string, unknown>): NormalizedTweet {
  const author = (t.author as Record<string, unknown>) || {};
  return {
    id: String(t.id || ''),
    text: String(t.text || ''),
    author: {
      username: String(author.userName || author.username || author.screen_name || ''),
      name: String(author.name || ''),
      verified: Boolean(author.isBlueVerified || author.verified),
    },
    metrics: {
      likes: Number(t.likeCount || t.likes || 0),
      retweets: Number(t.retweetCount || t.retweets || 0),
      replies: Number(t.replyCount || t.replies || 0),
      views: t.viewCount ? Number(t.viewCount) : (t.views ? Number(t.views) : undefined),
    },
    created_at: String(t.createdAt || t.created_at || ''),
    url: String(t.url || `https://x.com/i/status/${t.id}`),
  };
}

export async function tier2Search(
  apiKey: string,
  query: string,
  queryType: string,
  cursor?: string,
): Promise<ActionResult> {
  try {
    const params = new URLSearchParams({ query, queryType });
    if (cursor) params.set('cursor', cursor);

    const res = await fetch(`https://api.twitterapi.io/twitter/tweet/advanced_search?${params}`, {
      headers: { 'X-API-Key': apiKey },
    });

    if (!res.ok) {
      return { success: false, error: `TwitterAPI.io returned ${res.status}: ${await res.text()}` };
    }

    const json = await res.json() as Record<string, unknown>;
    const tweets = (json.tweets as Array<Record<string, unknown>>) || [];

    const normalized: NormalizedTweet[] = tweets.map(t => normalizeTier2Tweet(t));
    const result: XSearchResult = {
      tweets: normalized,
      tier_used: 2,
      has_more: Boolean(json.has_next_page),
      cursor: json.next_cursor ? String(json.next_cursor) : undefined,
    };

    logger.info('Tier 2 search successful', { query, resultCount: normalized.length });
    return { success: true, data: result as unknown as Record<string, unknown> };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Tier 2 search failed: ${msg}` };
  }
}

export async function tier2UserInfo(apiKey: string, username: string): Promise<ActionResult> {
  try {
    const params = new URLSearchParams({ userName: username });
    const res = await fetch(`https://api.twitterapi.io/twitter/user/info?${params}`, {
      headers: { 'X-API-Key': apiKey },
    });

    if (!res.ok) {
      return { success: false, error: `TwitterAPI.io returned ${res.status}` };
    }

    const json = await res.json() as Record<string, unknown>;
    const data = (json.data || json) as Record<string, unknown>;
    const result: XUserResult = {
      id: String(data.id || ''),
      username: String(data.userName || data.username || username),
      name: String(data.name || ''),
      description: String(data.description || ''),
      verified: Boolean(data.isBlueVerified || data.verified),
      followers: Number(data.followers || data.followers_count || 0),
      following: Number(data.following || data.friends_count || 0),
      tweet_count: Number(data.statusesCount || data.tweets_count || 0),
      profile_image_url: data.profileImageUrl ? String(data.profileImageUrl) : undefined,
      url: data.url ? String(data.url) : undefined,
      tier_used: 2,
    };

    logger.info('Tier 2 user info successful', { username });
    return { success: true, data: result as unknown as Record<string, unknown> };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Tier 2 user info failed: ${msg}` };
  }
}

export async function tier2UserTweets(
  apiKey: string,
  username: string,
  cursor?: string,
): Promise<ActionResult> {
  try {
    const params = new URLSearchParams({ userName: username });
    if (cursor) params.set('cursor', cursor);

    const res = await fetch(`https://api.twitterapi.io/twitter/user/last_tweets?${params}`, {
      headers: { 'X-API-Key': apiKey },
    });

    if (!res.ok) {
      return { success: false, error: `TwitterAPI.io returned ${res.status}` };
    }

    const json = await res.json() as Record<string, unknown>;
    const tweets = (json.tweets as Array<Record<string, unknown>>) || [];

    const normalized: NormalizedTweet[] = tweets.map(t => normalizeTier2Tweet(t));
    const result: XSearchResult = {
      tweets: normalized,
      tier_used: 2,
      has_more: Boolean(json.has_next_page),
      cursor: json.next_cursor ? String(json.next_cursor) : undefined,
    };

    logger.info('Tier 2 user tweets successful', { username, resultCount: normalized.length });
    return { success: true, data: result as unknown as Record<string, unknown> };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Tier 2 user tweets failed: ${msg}` };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Tier 3 — Official X API v2 (twitter-api-v2 library)
// ═══════════════════════════════════════════════════════════════════════════════

export async function tier3Search(client: TwitterApi, query: string): Promise<ActionResult> {
  try {
    const sanitizedQuery = query
      .replace(/\b(context|place|place_country|point_radius|bounding_box):[^\s)]+/gi, '')
      .replace(/\s+/g, ' ')
      .trim();

    const result = await client.v2.search(sanitizedQuery || query, {
      max_results: 10,
      'tweet.fields': ['public_metrics', 'created_at', 'author_id', 'text'],
      'user.fields': ['username', 'name', 'verified'],
      expansions: ['author_id'],
    });

    const users = new Map<string, { username: string; name: string; verified: boolean }>();
    if (result.includes?.users) {
      for (const u of result.includes.users) {
        users.set(u.id, { username: u.username, name: u.name, verified: Boolean(u.verified) });
      }
    }

    const normalized: NormalizedTweet[] = (result.data?.data || []).map(t => {
      const author = users.get(t.author_id || '') || { username: '', name: '', verified: false };
      return {
        id: t.id,
        text: t.text,
        author,
        metrics: {
          likes: t.public_metrics?.like_count || 0,
          retweets: t.public_metrics?.retweet_count || 0,
          replies: t.public_metrics?.reply_count || 0,
          views: t.public_metrics?.impression_count,
        },
        created_at: t.created_at || '',
        url: `https://x.com/${author.username}/status/${t.id}`,
      };
    });

    const searchResult: XSearchResult = {
      tweets: normalized,
      tier_used: 3,
      has_more: Boolean(result.meta?.next_token),
      cursor: result.meta?.next_token,
    };

    logger.info('Tier 3 search successful', { query, resultCount: normalized.length });
    return { success: true, data: searchResult as unknown as Record<string, unknown> };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('Tier 3 search failed', { error: msg });
    return { success: false, error: `Tier 3 search failed: ${msg}` };
  }
}

export async function tier3LookupTweet(client: TwitterApi, tweetId: string): Promise<ActionResult> {
  try {
    const result = await client.v2.singleTweet(tweetId, {
      'tweet.fields': ['public_metrics', 'created_at', 'author_id', 'text'],
      'user.fields': ['username', 'name', 'verified'],
      expansions: ['author_id'],
    });

    const authorData = result.includes?.users?.[0];
    const author = authorData
      ? { username: authorData.username, name: authorData.name, verified: Boolean(authorData.verified) }
      : { username: '', name: '', verified: false };

    const tweet = result.data;
    const normalized: NormalizedTweet = {
      id: tweet.id,
      text: tweet.text,
      author,
      metrics: {
        likes: tweet.public_metrics?.like_count || 0,
        retweets: tweet.public_metrics?.retweet_count || 0,
        replies: tweet.public_metrics?.reply_count || 0,
        views: tweet.public_metrics?.impression_count,
      },
      created_at: tweet.created_at || '',
      url: `https://x.com/${author.username}/status/${tweet.id}`,
    };

    const searchResult: XSearchResult = { tweets: [normalized], tier_used: 3, has_more: false };
    logger.info('Tier 3 tweet lookup successful', { tweetId });
    return { success: true, data: searchResult as unknown as Record<string, unknown> };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('Tier 3 tweet lookup failed', { error: msg });
    return { success: false, error: `Tier 3 tweet lookup failed: ${msg}` };
  }
}

export async function tier3LookupUser(client: TwitterApi, username: string): Promise<ActionResult> {
  try {
    const result = await client.v2.userByUsername(username, {
      'user.fields': ['public_metrics', 'description', 'verified', 'profile_image_url', 'url'],
    });

    const u = result.data;
    const userResult: XUserResult = {
      id: u.id,
      username: u.username,
      name: u.name,
      description: u.description || '',
      verified: Boolean(u.verified),
      followers: u.public_metrics?.followers_count || 0,
      following: u.public_metrics?.following_count || 0,
      tweet_count: u.public_metrics?.tweet_count || 0,
      profile_image_url: u.profile_image_url,
      url: u.url,
      tier_used: 3,
    };

    logger.info('Tier 3 user lookup successful', { username });
    return { success: true, data: userResult as unknown as Record<string, unknown> };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('Tier 3 user lookup failed', { error: msg });
    return { success: false, error: `Tier 3 user lookup failed: ${msg}` };
  }
}

export async function tier3UserTweets(client: TwitterApi, username: string): Promise<ActionResult> {
  try {
    const userResult = await client.v2.userByUsername(username);
    const userId = userResult.data.id;

    const result = await client.v2.userTimeline(userId, {
      max_results: 20,
      'tweet.fields': ['public_metrics', 'created_at', 'text'],
    });

    const normalized: NormalizedTweet[] = (result.data?.data || []).map(t => ({
      id: t.id,
      text: t.text,
      author: { username, name: userResult.data.name, verified: Boolean(userResult.data.verified) },
      metrics: {
        likes: t.public_metrics?.like_count || 0,
        retweets: t.public_metrics?.retweet_count || 0,
        replies: t.public_metrics?.reply_count || 0,
        views: t.public_metrics?.impression_count,
      },
      created_at: t.created_at || '',
      url: `https://x.com/${username}/status/${t.id}`,
    }));

    const searchResult: XSearchResult = {
      tweets: normalized,
      tier_used: 3,
      has_more: Boolean(result.meta?.next_token),
      cursor: result.meta?.next_token,
    };

    logger.info('Tier 3 user tweets successful', { username, resultCount: normalized.length });
    return { success: true, data: searchResult as unknown as Record<string, unknown> };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('Tier 3 user tweets failed', { error: msg });
    return { success: false, error: `Tier 3 user tweets failed: ${msg}` };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Tier 4 — xAI Grok x_search (Responses API, final fallback)
// ═══════════════════════════════════════════════════════════════════════════════

/** Extract text content from xAI Responses API output (handles multiple response shapes) */
function extractXaiResponseText(json: Record<string, unknown>): string | null {
  if (typeof json.output_text === 'string' && json.output_text.length > 0) {
    return json.output_text;
  }

  const output = json.output as Array<Record<string, unknown>> | undefined;
  if (output) {
    for (const item of output) {
      if (item.type === 'message') {
        const content = item.content as Array<Record<string, unknown>> | undefined;
        if (content) {
          for (const block of content) {
            if (block.type === 'output_text' && typeof block.text === 'string') {
              return block.text;
            }
            if (block.type === 'text' && typeof block.text === 'string') {
              return block.text;
            }
          }
        }
      }
    }
    const types = output.map(item => item.type).join(', ');
    logger.warn('xAI response output types (no text extracted)', { types, outputCount: output.length });
  }

  const choices = json.choices as Array<Record<string, unknown>> | undefined;
  if (choices?.[0]) {
    const message = choices[0].message as Record<string, unknown> | undefined;
    if (message?.content && typeof message.content === 'string') {
      return message.content;
    }
  }

  logger.warn('Could not extract text from xAI response', { keys: Object.keys(json) });
  return null;
}

/** Parse JSON from Grok's response, stripping markdown fences if present */
function parseXaiJson(text: string): Record<string, unknown> | null {
  try {
    let cleaned = text.trim();
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
    }
    return JSON.parse(cleaned) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function xaiSearch(xaiApiKey: string, query: string): Promise<ActionResult> {
  try {
    const res = await fetch('https://api.x.ai/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${xaiApiKey}`,
      },
      body: JSON.stringify({
        model: 'grok-4-1-fast',
        instructions: 'You are a X/Twitter search tool. Search X for the user\'s query using the x_search tool. Return ONLY valid JSON (no markdown fences) with this exact structure: {"tweets":[{"id":"string","text":"string","author":{"username":"string","name":"string","verified":boolean},"metrics":{"likes":number,"retweets":number,"replies":number},"created_at":"string","url":"string"}],"has_more":false}. If looking up a user profile, return: {"user":{"id":"string","username":"string","name":"string","description":"string","verified":boolean,"followers":number,"following":number,"tweet_count":number},"has_more":false}. Return real data from x_search results. Maximum 20 tweets.',
        input: [{ role: 'user', content: query }],
        tools: [{ type: 'x_search' }],
        temperature: 0,
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      return { success: false, error: `xAI API returned ${res.status}: ${body.substring(0, 200)}` };
    }

    const json = await res.json() as Record<string, unknown>;

    const text = extractXaiResponseText(json);
    if (!text) {
      return { success: false, error: 'xAI returned empty response' };
    }

    const parsed = parseXaiJson(text);
    if (!parsed) {
      logger.warn('Could not parse xAI response as structured JSON, returning raw text');
      return {
        success: true,
        data: { raw_text: text, tier_used: 4, has_more: false } as unknown as Record<string, unknown>,
      };
    }

    if ('user' in parsed && parsed.user) {
      const u = parsed.user as Record<string, unknown>;
      const userResult: XUserResult = {
        id: String(u.id || ''),
        username: String(u.username || ''),
        name: String(u.name || ''),
        description: String(u.description || ''),
        verified: Boolean(u.verified),
        followers: Number(u.followers || 0),
        following: Number(u.following || 0),
        tweet_count: Number(u.tweet_count || 0),
        tier_used: 4,
      };
      logger.info('Tier 4 (xAI) user lookup successful', { query });
      return { success: true, data: userResult as unknown as Record<string, unknown> };
    }

    const tweets = ((parsed.tweets || []) as Array<Record<string, unknown>>).map(t => {
      const author = (t.author as Record<string, unknown>) || {};
      const metrics = (t.metrics as Record<string, unknown>) || {};
      return {
        id: String(t.id || ''),
        text: String(t.text || ''),
        author: {
          username: String(author.username || ''),
          name: String(author.name || ''),
          verified: Boolean(author.verified),
        },
        metrics: {
          likes: Number(metrics.likes || 0),
          retweets: Number(metrics.retweets || 0),
          replies: Number(metrics.replies || 0),
          views: metrics.views ? Number(metrics.views) : undefined,
        },
        created_at: String(t.created_at || ''),
        url: String(t.url || ''),
      } as NormalizedTweet;
    });

    const searchResult: XSearchResult = {
      tweets,
      tier_used: 4,
      has_more: Boolean(parsed.has_more),
    };

    logger.info('Tier 4 (xAI) search successful', { query, resultCount: tweets.length });
    return { success: true, data: searchResult as unknown as Record<string, unknown> };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('Tier 4 (xAI) search failed', { error: msg });
    return { success: false, error: `Tier 4 (xAI) failed: ${msg}` };
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Extract tweet ID from a tweetId param or a full URL */
export function extractTweetId(params: Record<string, unknown>): string | null {
  const tweetId = params.tweetId as string | undefined;
  const url = params.url as string | undefined;

  if (tweetId) return tweetId;

  if (url) {
    const match = url.match(/(?:x\.com|twitter\.com)\/\w+\/status\/(\d+)/);
    if (match) return match[1];
  }

  return null;
}

/** Strip leading @ from username if present */
export function normalizeUsername(username: string | undefined): string | null {
  if (!username) return null;
  return username.startsWith('@') ? username.slice(1) : username;
}
