import type { Template, DeployResult, ChannelMetrics, ChannelConfig } from '../types.js';
import { BaseChannel } from './base-channel.js';

// ─── Landing Page Channel ─────────────────────────────────────────────────────

/**
 * Landing page channel adapter.
 *
 * Deploys page variants for A/B testing against the current champion.
 * Scores by conversion rate (CTA clicks / visitors) after a 7-day window.
 *
 * Deployment target: Vercel preview deployments for A/B splitting.
 *
 * STATUS: Not yet implemented — deploy() and getMetrics() throw until
 * wired to Vercel + analytics APIs. isImplemented() returns false so the
 * engine will skip this channel.
 */
export class LandingPageChannel extends BaseChannel {
  readonly name = 'landing-page';
  readonly scoringWindowMs = 7 * 24 * 60 * 60 * 1000; // 7 days
  readonly cooldownMs = 24 * 60 * 60 * 1000; // 24 hours
  readonly minSampleSize = 50; // Minimum visitors for statistical significance

  override isImplemented(): boolean {
    return false; // Change to true once deploy() and getMetrics() are wired
  }

  async deploy(_variant: Template): Promise<DeployResult> {
    // Wire to Vercel API:
    // 1. Generate HTML from template variables
    // 2. Deploy to A/B split URL (Vercel preview deployment)
    // 3. Configure traffic split (50/50 with current champion)
    // 4. Return deployment URL for scoring
    throw new Error('LandingPageChannel.deploy() not yet implemented — wire to Vercel API');
  }

  async getMetrics(_deployId: string): Promise<ChannelMetrics> {
    // Pull from analytics (GA4, Vercel Analytics, or Mixpanel):
    // Metrics: visitors, time_on_page, scroll_depth, cta_clicks, signups
    // Primary metric: conversion_rate = cta_clicks / visitors
    throw new Error('LandingPageChannel.getMetrics() not yet implemented — wire to analytics API');
  }

  parseProgram(programMd: string): ChannelConfig {
    return {
      name: this.name,
      scoringWindowMs: this.scoringWindowMs,
      cooldownMs: this.cooldownMs,
      minSampleSize: this.minSampleSize,
      winThreshold: parseWinThreshold(programMd, 0.5),
      variablesToTest: parseVariables(programMd),
      scoringMetric: 'conversion_rate',
      goal: parseGoal(programMd, 'Maximize landing page conversion rate'),
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
  if (!section) return ['headline', 'subheadline', 'cta_text', 'hero_copy'];

  const lines = section[0].split('\n');
  for (const line of lines) {
    const match = line.match(/^\d+\.\s+(\w+)/);
    if (match?.[1]) variables.push(match[1]);
  }

  return variables.length > 0 ? variables : ['headline', 'subheadline', 'cta_text', 'hero_copy'];
}

function parseGoal(programMd: string, defaultGoal: string): string {
  const match = programMd.match(/##\s*Goal\s*\n+(.+)/i);
  return match?.[1]?.trim() ?? defaultGoal;
}
