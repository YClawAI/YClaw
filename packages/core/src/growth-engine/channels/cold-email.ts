import type { Template, DeployResult, ChannelMetrics, ChannelConfig } from '../types.js';
import { BaseChannel } from './base-channel.js';

// ─── Cold Email Channel ───────────────────────────────────────────────────────

/**
 * Cold email channel adapter.
 *
 * Deploys email variants via an email sending service (SendGrid/Resend).
 * Scores by positive reply rate after a 72-hour window.
 *
 * Uses its OWN email credentials — separate from any existing email integrations.
 *
 * STATUS: Not yet implemented — deploy() and getMetrics() throw until
 * wired to a real email sending service. isImplemented() returns false
 * so the engine will skip this channel.
 */
export class ColdEmailChannel extends BaseChannel {
  readonly name = 'cold-email';
  readonly scoringWindowMs = 72 * 60 * 60 * 1000; // 72 hours
  readonly cooldownMs = 24 * 60 * 60 * 1000; // 24 hours
  readonly minSampleSize = 100;

  override isImplemented(): boolean {
    return false; // Change to true once deploy() and getMetrics() are wired
  }

  async deploy(_variant: Template): Promise<DeployResult> {
    // Wire to SendGrid/Resend API:
    // 1. Select leads from ICP list (not previously contacted)
    // 2. Render template with per-lead personalization ({{first_name}})
    // 3. Send via email infrastructure
    // 4. Return deployId for later scoring
    throw new Error('ColdEmailChannel.deploy() not yet implemented — wire to SendGrid/Resend');
  }

  async getMetrics(_deployId: string): Promise<ChannelMetrics> {
    // Pull from SendGrid/Resend API:
    // Metrics: opens, clicks, replies, positive_replies, bounces, unsubscribes
    // Primary metric: positive_reply_rate = positive_replies / total_sent
    throw new Error('ColdEmailChannel.getMetrics() not yet implemented — wire to SendGrid/Resend');
  }

  parseProgram(programMd: string): ChannelConfig {
    return {
      name: this.name,
      scoringWindowMs: this.scoringWindowMs,
      cooldownMs: this.cooldownMs,
      minSampleSize: this.minSampleSize,
      winThreshold: parseWinThreshold(programMd, 0.5),
      variablesToTest: parseVariables(programMd),
      scoringMetric: 'positive_reply_rate',
      goal: parseGoal(programMd, 'Maximize positive reply rate from Web3 developer leads'),
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
  if (!section) return ['subject_line', 'opening', 'value_prop', 'cta'];

  const lines = section[0].split('\n');
  for (const line of lines) {
    const match = line.match(/^\d+\.\s+(\w+)/);
    if (match?.[1]) variables.push(match[1]);
  }

  return variables.length > 0 ? variables : ['subject_line', 'opening', 'value_prop', 'cta'];
}

function parseGoal(programMd: string, defaultGoal: string): string {
  const match = programMd.match(/##\s*Goal\s*\n+(.+)/i);
  return match?.[1]?.trim() ?? defaultGoal;
}
