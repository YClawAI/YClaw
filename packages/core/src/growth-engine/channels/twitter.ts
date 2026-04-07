import type { Template, DeployResult, ChannelMetrics, ChannelConfig } from '../types.js';
import { BaseChannel } from './base-channel.js';

// ─── Twitter/X Channel ────────────────────────────────────────────────────────

/**
 * Twitter/X channel adapter.
 *
 * Each post is its own experiment (minSampleSize = 1).
 * Scores by engagement rate after a 48-hour window.
 *
 * Uses SEPARATE X API credentials from Ember's existing integration
 * to avoid any conflict with Ember's posting schedule.
 *
 * STATUS: Not yet implemented — deploy() and getMetrics() throw until
 * wired to the X API v2. isImplemented() returns false so the engine
 * will skip this channel.
 */
export class TwitterChannel extends BaseChannel {
  readonly name = 'twitter';
  readonly scoringWindowMs = 48 * 60 * 60 * 1000; // 48 hours
  readonly cooldownMs = 4 * 60 * 60 * 1000; // 4 hours between posts
  readonly minSampleSize = 1; // Each post is its own experiment

  override isImplemented(): boolean {
    return false; // Change to true once deploy() and getMetrics() are wired
  }

  async deploy(_variant: Template): Promise<DeployResult> {
    // Wire to X API v2 (using growth engine's own credentials, NOT Ember's):
    // 1. Post to X via API
    // 2. Return tweet ID for later scoring
    throw new Error('TwitterChannel.deploy() not yet implemented — wire to X API v2');
  }

  async getMetrics(_deployId: string): Promise<ChannelMetrics> {
    // Pull from X API v2:
    // Metrics: impressions, engagements, replies, retweets, quote_tweets, profile_visits
    // Primary metric: engagement_rate = engagements / impressions
    throw new Error('TwitterChannel.getMetrics() not yet implemented — wire to X API v2');
  }

  parseProgram(programMd: string): ChannelConfig {
    return {
      name: this.name,
      scoringWindowMs: this.scoringWindowMs,
      cooldownMs: this.cooldownMs,
      minSampleSize: this.minSampleSize,
      winThreshold: parseWinThreshold(programMd, 0.5),
      variablesToTest: parseVariables(programMd),
      scoringMetric: 'engagement_rate',
      goal: parseGoal(programMd, 'Maximize engagement rate on X/Twitter posts'),
    };
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseWinThreshold(programMd: string, defaultValue: number): number {
  const match = programMd.match(/win\s+threshold[:\s]*>?\s*.*?(\d+\.?\d*)\s*percentage/i);
  if (match?.[1]) return parseFloat(match[1]);
  return defaultValue;
}

function parseVariables(programMd: string): string[] {
  const variables: string[] = [];
  const section = programMd.match(/variables\s+to\s+test[^]*?(?=##|\n\n##|$)/i);
  if (!section) return ['hook', 'body', 'cta', 'format'];

  const lines = section[0].split('\n');
  for (const line of lines) {
    const match = line.match(/^\d+\.\s+(\w+)/);
    if (match?.[1]) variables.push(match[1]);
  }

  return variables.length > 0 ? variables : ['hook', 'body', 'cta', 'format'];
}

function parseGoal(programMd: string, defaultGoal: string): string {
  const match = programMd.match(/##\s*Goal\s*\n+(.+)/i);
  return match?.[1]?.trim() ?? defaultGoal;
}
