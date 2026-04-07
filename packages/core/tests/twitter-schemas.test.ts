import { describe, it, expect } from 'vitest';
import { ACTION_SCHEMAS, ACTION_DEFAULTS } from '../src/actions/schemas.js';

// ─── Twitter Write Action Schemas ───────────────────────────────────────────

describe('Twitter action schemas', () => {
  const TWITTER_ACTIONS = [
    'twitter:post',
    'twitter:thread',
    'twitter:reply',
    'twitter:like',
    'twitter:retweet',
    'twitter:follow',
    'twitter:dm',
    'twitter:media_upload',
    'twitter:update_profile',
    'twitter:update_profile_image',
    'twitter:update_profile_banner',
    'twitter:read_metrics',
  ];

  it('has schemas for all 12 twitter actions', () => {
    for (const action of TWITTER_ACTIONS) {
      expect(ACTION_SCHEMAS[action], `Missing schema for ${action}`).toBeDefined();
      expect(ACTION_SCHEMAS[action].description).toBeTruthy();
      expect(ACTION_SCHEMAS[action].parameters).toBeDefined();
    }
  });

  it('twitter:post requires text', () => {
    const schema = ACTION_SCHEMAS['twitter:post'];
    expect(schema.parameters.text.required).toBe(true);
    expect(schema.parameters.text.type).toBe('string');
  });

  it('twitter:thread requires tweets array', () => {
    const schema = ACTION_SCHEMAS['twitter:thread'];
    expect(schema.parameters.tweets.required).toBe(true);
    expect(schema.parameters.tweets.type).toBe('array');
    expect(schema.parameters.tweets.items).toBeDefined();
    expect(schema.parameters.tweets.items!.type).toBe('string');
  });

  it('twitter:reply requires tweetId and text', () => {
    const schema = ACTION_SCHEMAS['twitter:reply'];
    expect(schema.parameters.tweetId.required).toBe(true);
    expect(schema.parameters.text.required).toBe(true);
  });

  it('twitter:like requires tweetId', () => {
    const schema = ACTION_SCHEMAS['twitter:like'];
    expect(schema.parameters.tweetId.required).toBe(true);
    expect(schema.parameters.tweetId.type).toBe('string');
  });

  it('twitter:retweet requires tweetId', () => {
    const schema = ACTION_SCHEMAS['twitter:retweet'];
    expect(schema.parameters.tweetId.required).toBe(true);
  });

  it('twitter:follow requires targetUserId', () => {
    const schema = ACTION_SCHEMAS['twitter:follow'];
    expect(schema.parameters.targetUserId.required).toBe(true);
    expect(schema.parameters.targetUserId.type).toBe('string');
  });

  it('twitter:dm requires participantId and text', () => {
    const schema = ACTION_SCHEMAS['twitter:dm'];
    expect(schema.parameters.participantId.required).toBe(true);
    expect(schema.parameters.text.required).toBe(true);
  });

  it('twitter:media_upload has optional text and media params', () => {
    const schema = ACTION_SCHEMAS['twitter:media_upload'];
    expect(schema.parameters.text.required).toBeUndefined();
    expect(schema.parameters.mediaData.type).toBe('string');
    expect(schema.parameters.mediaPath.type).toBe('string');
  });

  it('twitter:update_profile has all optional fields', () => {
    const schema = ACTION_SCHEMAS['twitter:update_profile'];
    expect(schema.parameters.name.required).toBeUndefined();
    expect(schema.parameters.description.required).toBeUndefined();
    expect(schema.parameters.url.required).toBeUndefined();
    expect(schema.parameters.location.required).toBeUndefined();
  });

  it('twitter:update_profile_image requires image', () => {
    const schema = ACTION_SCHEMAS['twitter:update_profile_image'];
    expect(schema.parameters.image.required).toBe(true);
    expect(schema.parameters.image.type).toBe('string');
  });

  it('twitter:update_profile_banner requires banner', () => {
    const schema = ACTION_SCHEMAS['twitter:update_profile_banner'];
    expect(schema.parameters.banner.required).toBe(true);
    expect(schema.parameters.banner.type).toBe('string');
  });

  it('twitter:read_metrics accepts tweetId or tweetIds', () => {
    const schema = ACTION_SCHEMAS['twitter:read_metrics'];
    expect(schema.parameters.tweetId.type).toBe('string');
    expect(schema.parameters.tweetIds.type).toBe('array');
    expect(schema.parameters.tweetIds.items!.type).toBe('string');
    // Neither is individually required — one or the other
    expect(schema.parameters.tweetId.required).toBeUndefined();
    expect(schema.parameters.tweetIds.required).toBeUndefined();
  });
});

// ─── X Search Action Schemas ────────────────────────────────────────────────

describe('X Search action schemas', () => {
  const X_ACTIONS = [
    'x:search',
    'x:lookup',
    'x:user',
    'x:user_tweets',
  ];

  it('has schemas for all 4 x search actions', () => {
    for (const action of X_ACTIONS) {
      expect(ACTION_SCHEMAS[action], `Missing schema for ${action}`).toBeDefined();
      expect(ACTION_SCHEMAS[action].description).toBeTruthy();
      expect(ACTION_SCHEMAS[action].parameters).toBeDefined();
    }
  });

  it('x:search requires query', () => {
    const schema = ACTION_SCHEMAS['x:search'];
    expect(schema.parameters.query.required).toBe(true);
    expect(schema.parameters.query.type).toBe('string');
  });

  it('x:search has optional queryType and cursor', () => {
    const schema = ACTION_SCHEMAS['x:search'];
    expect(schema.parameters.queryType.required).toBeUndefined();
    expect(schema.parameters.cursor.required).toBeUndefined();
  });

  it('x:lookup accepts tweetId or url (neither required individually)', () => {
    const schema = ACTION_SCHEMAS['x:lookup'];
    expect(schema.parameters.tweetId.type).toBe('string');
    expect(schema.parameters.url.type).toBe('string');
    expect(schema.parameters.tweetId.required).toBeUndefined();
    expect(schema.parameters.url.required).toBeUndefined();
  });

  it('x:user requires username', () => {
    const schema = ACTION_SCHEMAS['x:user'];
    expect(schema.parameters.username.required).toBe(true);
    expect(schema.parameters.username.type).toBe('string');
  });

  it('x:user_tweets requires username', () => {
    const schema = ACTION_SCHEMAS['x:user_tweets'];
    expect(schema.parameters.username.required).toBe(true);
  });

  it('x:user_tweets has optional cursor', () => {
    const schema = ACTION_SCHEMAS['x:user_tweets'];
    expect(schema.parameters.cursor.required).toBeUndefined();
    expect(schema.parameters.cursor.type).toBe('string');
  });
});

// ─── ACTION_DEFAULTS ────────────────────────────────────────────────────────

describe('ACTION_DEFAULTS for X Search', () => {
  it('x:search defaults queryType to Latest', () => {
    expect(ACTION_DEFAULTS['x:search']).toBeDefined();
    expect(ACTION_DEFAULTS['x:search'].queryType).toBe('Latest');
  });
});

// ─── Schema Structural Integrity ────────────────────────────────────────────

describe('Schema structural integrity', () => {
  const ALL_ACTIONS = Object.keys(ACTION_SCHEMAS);

  it('every schema has a non-empty description', () => {
    for (const action of ALL_ACTIONS) {
      expect(
        ACTION_SCHEMAS[action].description.length,
        `${action} has empty description`,
      ).toBeGreaterThan(0);
    }
  });

  it('every parameter has a valid type', () => {
    const validTypes = ['string', 'number', 'boolean', 'object', 'array'];
    for (const action of ALL_ACTIONS) {
      const params = ACTION_SCHEMAS[action].parameters;
      for (const [paramName, param] of Object.entries(params)) {
        expect(
          validTypes,
          `${action}.${paramName} has invalid type "${param.type}"`,
        ).toContain(param.type);
      }
    }
  });

  it('every parameter has a non-empty description', () => {
    for (const action of ALL_ACTIONS) {
      const params = ACTION_SCHEMAS[action].parameters;
      for (const [paramName, param] of Object.entries(params)) {
        expect(
          param.description.length,
          `${action}.${paramName} has empty description`,
        ).toBeGreaterThan(0);
      }
    }
  });

  it('array-type parameters have items defined', () => {
    for (const action of ALL_ACTIONS) {
      const params = ACTION_SCHEMAS[action].parameters;
      for (const [paramName, param] of Object.entries(params)) {
        if (param.type === 'array') {
          expect(
            param.items,
            `${action}.${paramName} is array type but missing items`,
          ).toBeDefined();
        }
      }
    }
  });

  it('total schema count includes twitter and x actions', () => {
    const twitterCount = ALL_ACTIONS.filter(a => a.startsWith('twitter:')).length;
    const xCount = ALL_ACTIONS.filter(a => a.startsWith('x:')).length;
    expect(twitterCount).toBe(12);
    expect(xCount).toBe(4);
  });
});
