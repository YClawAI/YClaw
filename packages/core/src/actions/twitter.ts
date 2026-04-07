import { TwitterApi } from 'twitter-api-v2';
import type { ActionResult, ActionExecutor } from './types.js';
import type { ToolDefinition } from '../config/schema.js';
import { createLogger } from '../logging/logger.js';

const logger = createLogger('twitter-executor');

// ─── Twitter / X Action Executor ────────────────────────────────────────────
//
// Actions:
//   twitter:post                  - Post a single tweet
//   twitter:thread                - Post a thread (array of tweets, 1s delay between each)
//   twitter:reply                 - Reply to a specific tweet
//   twitter:like                  - Like a tweet
//   twitter:retweet               - Retweet a tweet
//   twitter:follow                - Follow a user
//   twitter:dm                    - Send a direct message
//   twitter:media_upload          - Upload media and attach to tweet
//   twitter:update_profile        - Update profile name/bio/url/location
//   twitter:update_profile_image  - Update profile picture (base64 PNG)
//   twitter:update_profile_banner - Update banner image (base64 PNG)
//   twitter:read_metrics          - Read tweet engagement metrics
//

export class TwitterExecutor implements ActionExecutor {
  readonly name = 'twitter';
  private client: TwitterApi | null = null;

  constructor() {
    const appKey = process.env.TWITTER_APP_KEY;
    const appSecret = process.env.TWITTER_APP_SECRET;
    const accessToken = process.env.TWITTER_ACCESS_TOKEN;
    const accessSecret = process.env.TWITTER_ACCESS_SECRET;

    if (!appKey || !appSecret || !accessToken || !accessSecret) {
      logger.warn(
        'Twitter credentials not fully configured. Set TWITTER_APP_KEY, TWITTER_APP_SECRET, ' +
        'TWITTER_ACCESS_TOKEN, and TWITTER_ACCESS_SECRET environment variables.',
      );
      return;
    }

    this.client = new TwitterApi({
      appKey,
      appSecret,
      accessToken,
      accessSecret,
    });
  }

  // ─── Tool Definitions (colocated schemas) ─────────────────────────────────

  getToolDefinitions(): ToolDefinition[] {
    return [
      {
        name: 'twitter:post',
        description: 'Post a single tweet',
        parameters: {
          text: { type: 'string', description: 'Tweet text content (max 280 characters)', required: true },
        },
      },
      {
        name: 'twitter:thread',
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
      {
        name: 'twitter:reply',
        description: 'Reply to a specific tweet',
        parameters: {
          tweetId: { type: 'string', description: 'ID of the tweet to reply to', required: true },
          text: { type: 'string', description: 'Reply text content (max 280 characters)', required: true },
        },
      },
      {
        name: 'twitter:like',
        description: 'Like a tweet',
        parameters: {
          tweetId: { type: 'string', description: 'ID of the tweet to like', required: true },
        },
      },
      {
        name: 'twitter:retweet',
        description: 'Retweet a tweet',
        parameters: {
          tweetId: { type: 'string', description: 'ID of the tweet to retweet', required: true },
        },
      },
      {
        name: 'twitter:follow',
        description: 'Follow a Twitter/X user by their user ID',
        parameters: {
          targetUserId: { type: 'string', description: 'Twitter user ID of the account to follow', required: true },
        },
      },
      {
        name: 'twitter:dm',
        description: 'Send a direct message to a Twitter/X user',
        parameters: {
          participantId: { type: 'string', description: 'Twitter user ID or conversation ID of the DM recipient', required: true },
          text: { type: 'string', description: 'DM text content', required: true },
        },
      },
      {
        name: 'twitter:media_upload',
        description: 'Upload media (image) and optionally post a tweet with it. Provide either mediaData (base64) or mediaPath.',
        parameters: {
          text: { type: 'string', description: 'Tweet text to post with the media (optional — omit to upload without tweeting)' },
          mediaData: { type: 'string', description: 'Base64-encoded image data (provide this or mediaPath)' },
          mediaPath: { type: 'string', description: 'File path to the image (provide this or mediaData)' },
        },
      },
      {
        name: 'twitter:update_profile',
        description: 'Update Twitter/X profile fields (name, bio, url, location). Provide at least one field.',
        parameters: {
          name: { type: 'string', description: 'Display name' },
          description: { type: 'string', description: 'Bio / profile description' },
          url: { type: 'string', description: 'Profile website URL' },
          location: { type: 'string', description: 'Profile location text' },
        },
      },
      {
        name: 'twitter:update_profile_image',
        description: 'Update Twitter/X profile picture',
        parameters: {
          image: { type: 'string', description: 'Base64-encoded PNG image data for the profile picture', required: true },
        },
      },
      {
        name: 'twitter:update_profile_banner',
        description: 'Update Twitter/X profile banner image',
        parameters: {
          banner: { type: 'string', description: 'Base64-encoded PNG image data for the banner (recommended 1500x500)', required: true },
        },
      },
      {
        name: 'twitter:read_metrics',
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
    ];
  }

  async execute(action: string, params: Record<string, unknown>): Promise<ActionResult> {
    if (!this.client) {
      return { success: false, error: 'Twitter client not initialized: missing credentials' };
    }

    switch (action) {
      case 'post':
        return this.post(params);
      case 'thread':
        return this.thread(params);
      case 'reply':
        return this.reply(params);
      case 'like':
        return this.like(params);
      case 'retweet':
        return this.retweet(params);
      case 'follow':
        return this.follow(params);
      case 'dm':
        return this.dm(params);
      case 'media_upload':
        return this.mediaUpload(params);
      case 'update_profile':
        return this.updateProfile(params);
      case 'update_profile_image':
        return this.updateProfileImage(params);
      case 'update_profile_banner':
        return this.updateProfileBanner(params);
      case 'read_metrics':
        return this.readMetrics(params);
      default:
        return { success: false, error: `Unknown Twitter action: ${action}` };
    }
  }

  async healthCheck(): Promise<boolean> {
    if (!this.client) return false;
    try {
      await this.client.v2.me();
      return true;
    } catch (err) {
      logger.error('Twitter health check failed', { error: (err as Error).message });
      return false;
    }
  }

  // ─── Post a single tweet ──────────────────────────────────────────────────

  private async post(params: Record<string, unknown>): Promise<ActionResult> {
    const text = params.text as string | undefined;
    if (!text) {
      return { success: false, error: 'Missing required parameter: text' };
    }

    logger.info('Posting tweet', { textLength: text.length });

    try {
      const result = await this.client!.v2.tweet(text);
      logger.info('Tweet posted successfully', { tweetId: result.data.id });
      return {
        success: true,
        data: { tweetId: result.data.id, text: result.data.text },
      };
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      const apiData = (err as Record<string, unknown>)?.data;
      logger.error('Failed to post tweet', { error: errorMsg, apiData, code: (err as Record<string, unknown>)?.code });
      return { success: false, error: `Failed to post tweet: ${errorMsg}` };
    }
  }

  // ─── Post a thread (array of tweets with 1s delay) ───────────────────────

  private async thread(params: Record<string, unknown>): Promise<ActionResult> {
    const tweets = params.tweets as string[] | undefined;
    if (!tweets || !Array.isArray(tweets) || tweets.length === 0) {
      return { success: false, error: 'Missing required parameter: tweets (non-empty array of strings)' };
    }

    logger.info('Posting thread', { tweetCount: tweets.length });

    const postedIds: string[] = [];
    let previousTweetId: string | undefined;

    try {
      for (let i = 0; i < tweets.length; i++) {
        const tweetText = tweets[i];

        // Add 1-second delay between tweets (except the first)
        if (i > 0) {
          await this.delay(1000);
        }

        const tweetParams: { text: string; reply?: { in_reply_to_tweet_id: string } } = {
          text: tweetText,
        };

        if (previousTweetId) {
          tweetParams.reply = { in_reply_to_tweet_id: previousTweetId };
        }

        const result = await this.client!.v2.tweet(tweetParams);
        previousTweetId = result.data.id;
        postedIds.push(result.data.id);

        logger.info(`Thread tweet ${i + 1}/${tweets.length} posted`, { tweetId: result.data.id });
      }

      return {
        success: true,
        data: { tweetIds: postedIds, threadLength: postedIds.length },
      };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.error('Failed to post thread', { error: errorMsg, postedSoFar: postedIds.length });
      return {
        success: false,
        error: `Failed to post thread at tweet ${postedIds.length + 1}: ${errorMsg}`,
        data: { partialTweetIds: postedIds },
      };
    }
  }

  // ─── Reply to a specific tweet ────────────────────────────────────────────

  private async reply(params: Record<string, unknown>): Promise<ActionResult> {
    const text = params.text as string | undefined;
    const tweetId = params.tweetId as string | undefined;

    if (!text || !tweetId) {
      return { success: false, error: 'Missing required parameters: text, tweetId' };
    }

    logger.info('Replying to tweet', { tweetId, textLength: text.length });

    try {
      const result = await this.client!.v2.tweet({
        text,
        reply: { in_reply_to_tweet_id: tweetId },
      });

      logger.info('Reply posted successfully', { replyId: result.data.id, inReplyTo: tweetId });
      return {
        success: true,
        data: { tweetId: result.data.id, inReplyTo: tweetId },
      };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.error('Failed to reply to tweet', { error: errorMsg, tweetId });
      return { success: false, error: `Failed to reply: ${errorMsg}` };
    }
  }

  // ─── Like a tweet ─────────────────────────────────────────────────────────

  private async like(params: Record<string, unknown>): Promise<ActionResult> {
    const tweetId = params.tweetId as string | undefined;
    if (!tweetId) {
      return { success: false, error: 'Missing required parameter: tweetId' };
    }

    logger.info('Liking tweet', { tweetId });

    try {
      const me = await this.client!.v2.me();
      await this.client!.v2.like(me.data.id, tweetId);

      logger.info('Tweet liked successfully', { tweetId });
      return { success: true, data: { tweetId, liked: true } };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.error('Failed to like tweet', { error: errorMsg, tweetId });
      return { success: false, error: `Failed to like tweet: ${errorMsg}` };
    }
  }

  // ─── Retweet a tweet ──────────────────────────────────────────────────────

  private async retweet(params: Record<string, unknown>): Promise<ActionResult> {
    const tweetId = params.tweetId as string | undefined;
    if (!tweetId) {
      return { success: false, error: 'Missing required parameter: tweetId' };
    }

    logger.info('Retweeting', { tweetId });

    try {
      const me = await this.client!.v2.me();
      await this.client!.v2.retweet(me.data.id, tweetId);

      logger.info('Retweet successful', { tweetId });
      return { success: true, data: { tweetId, retweeted: true } };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.error('Failed to retweet', { error: errorMsg, tweetId });
      return { success: false, error: `Failed to retweet: ${errorMsg}` };
    }
  }

  // ─── Follow a user ──────────────────────────────────────────────────────

  private async follow(params: Record<string, unknown>): Promise<ActionResult> {
    const targetUserId = params.targetUserId as string | undefined;
    if (!targetUserId) {
      return { success: false, error: 'Missing required parameter: targetUserId' };
    }

    logger.info('Following user', { targetUserId });

    try {
      const me = await this.client!.v2.me();
      await this.client!.v2.follow(me.data.id, targetUserId);

      logger.info('Follow successful', { targetUserId });
      return { success: true, data: { targetUserId, following: true } };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.error('Failed to follow user', { error: errorMsg, targetUserId });
      return { success: false, error: `Failed to follow: ${errorMsg}` };
    }
  }

  // ─── Send a direct message ─────────────────────────────────────────────

  private async dm(params: Record<string, unknown>): Promise<ActionResult> {
    const participantId = params.participantId as string | undefined;
    const text = params.text as string | undefined;

    if (!participantId || !text) {
      return { success: false, error: 'Missing required parameters: participantId, text' };
    }

    logger.info('Sending DM', { participantId, textLength: text.length });

    try {
      const result = await this.client!.v2.sendDmInConversation(
        participantId,
        { text },
      );

      logger.info('DM sent', { participantId });
      return { success: true, data: { participantId, sent: true, result } };
    } catch (err) {
      // If no existing conversation, try creating a new one
      try {
        const result = await this.client!.v2.sendDmToParticipant(participantId, {
          text,
        });
        logger.info('DM sent (new conversation)', { participantId });
        return { success: true, data: { participantId, sent: true, result } };
      } catch (retryErr) {
        const errorMsg = retryErr instanceof Error ? retryErr.message : String(retryErr);
        logger.error('Failed to send DM', { error: errorMsg, participantId });
        return { success: false, error: `Failed to send DM: ${errorMsg}` };
      }
    }
  }

  // ─── Upload media and post tweet with it ───────────────────────────────

  private async mediaUpload(params: Record<string, unknown>): Promise<ActionResult> {
    const text = params.text as string | undefined;
    const mediaData = params.mediaData as string | undefined; // base64
    const mediaPath = params.mediaPath as string | undefined;

    if (!mediaData && !mediaPath) {
      return { success: false, error: 'Missing required parameter: mediaData (base64) or mediaPath' };
    }

    logger.info('Uploading media', { hasText: !!text, hasMediaData: !!mediaData, hasMediaPath: !!mediaPath });

    try {
      let mediaId: string;

      if (mediaPath) {
        mediaId = await this.client!.v1.uploadMedia(mediaPath);
      } else {
        const buffer = Buffer.from(mediaData!, 'base64');
        mediaId = await this.client!.v1.uploadMedia(buffer, { mimeType: 'image/png' });
      }

      logger.info('Media uploaded', { mediaId });

      // If text provided, post tweet with media
      if (text) {
        const result = await this.client!.v2.tweet({
          text,
          media: { media_ids: [mediaId] },
        });
        logger.info('Tweet with media posted', { tweetId: result.data.id });
        return {
          success: true,
          data: { mediaId, tweetId: result.data.id },
        };
      }

      return { success: true, data: { mediaId } };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.error('Failed to upload media', { error: errorMsg });
      return { success: false, error: `Failed to upload media: ${errorMsg}` };
    }
  }

  // ─── Update profile (name, bio, url, location) ─────────────────────────

  private async updateProfile(params: Record<string, unknown>): Promise<ActionResult> {
    const updates: Record<string, string> = {};
    if (params.name) updates.name = params.name as string;
    if (params.description) updates.description = params.description as string;
    if (params.url) updates.url = params.url as string;
    if (params.location) updates.location = params.location as string;

    if (Object.keys(updates).length === 0) {
      return { success: false, error: 'No profile fields to update. Provide: name, description, url, or location' };
    }

    logger.info('Updating profile', { fields: Object.keys(updates) });

    try {
      const result = await this.client!.v1.updateAccountProfile(updates);
      logger.info('Profile updated', { name: result.name, screenName: result.screen_name });
      return {
        success: true,
        data: {
          name: result.name,
          description: result.description,
          url: result.entities?.url?.urls?.[0]?.expanded_url,
          location: result.location,
        },
      };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.error('Failed to update profile', { error: errorMsg });
      return { success: false, error: `Failed to update profile: ${errorMsg}` };
    }
  }

  // ─── Update profile image ──────────────────────────────────────────────

  private async updateProfileImage(params: Record<string, unknown>): Promise<ActionResult> {
    const imageBase64 = params.image as string | undefined;
    if (!imageBase64) {
      return { success: false, error: 'Missing required parameter: image (base64-encoded PNG)' };
    }

    logger.info('Updating profile image');

    try {
      await this.client!.v1.post('account/update_profile_image.json', {
        image: imageBase64,
      });
      logger.info('Profile image updated');
      return { success: true, data: { updated: 'profile_image' } };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.error('Failed to update profile image', { error: errorMsg });
      return { success: false, error: `Failed to update profile image: ${errorMsg}` };
    }
  }

  // ─── Update profile banner ─────────────────────────────────────────────

  private async updateProfileBanner(params: Record<string, unknown>): Promise<ActionResult> {
    const bannerBase64 = params.banner as string | undefined;
    if (!bannerBase64) {
      return { success: false, error: 'Missing required parameter: banner (base64-encoded PNG)' };
    }

    logger.info('Updating profile banner');

    try {
      await this.client!.v1.post('account/update_profile_banner.json', {
        banner: bannerBase64,
      });
      logger.info('Profile banner updated');
      return { success: true, data: { updated: 'profile_banner' } };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.error('Failed to update profile banner', { error: errorMsg });
      return { success: false, error: `Failed to update profile banner: ${errorMsg}` };
    }
  }

  // ─── Read tweet engagement metrics ─────────────────────────────────────

  private async readMetrics(params: Record<string, unknown>): Promise<ActionResult> {
    const tweetIds = params.tweetIds as string[] | undefined;
    const tweetId = params.tweetId as string | undefined;

    const ids = tweetIds || (tweetId ? [tweetId] : null);
    if (!ids || ids.length === 0) {
      return { success: false, error: 'Missing required parameter: tweetIds (array) or tweetId (string)' };
    }

    logger.info('Reading tweet metrics', { count: ids.length });

    try {
      const result = await this.client!.v2.tweets(ids, {
        'tweet.fields': ['public_metrics', 'created_at', 'text'],
      });

      const metrics = result.data.map(tweet => ({
        id: tweet.id,
        text: tweet.text?.substring(0, 100),
        createdAt: tweet.created_at,
        metrics: tweet.public_metrics,
      }));

      logger.info('Metrics retrieved', { count: metrics.length });
      return { success: true, data: { tweets: metrics } };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.error('Failed to read metrics', { error: errorMsg });
      return { success: false, error: `Failed to read metrics: ${errorMsg}` };
    }
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
