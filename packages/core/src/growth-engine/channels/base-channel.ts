import { createLogger } from '../../logging/logger.js';
import type { Template, DeployResult, ChannelMetrics, ChannelConfig } from '../types.js';

const log = createLogger('growth-engine:channel');

// ─── BaseChannel ──────────────────────────────────────────────────────────────

/**
 * Abstract base for channel-specific deployment and metrics collection.
 *
 * Each channel implements:
 * - deploy(): Send a variant into the world
 * - getMetrics(): Pull results after scoring window
 * - parseProgram(): Parse channel-specific program.md into ChannelConfig
 *
 * Channel adapters use their OWN API credentials, separate from existing
 * agent integrations (e.g., growth engine's X credentials are separate from Ember's).
 */
export abstract class BaseChannel {
  abstract readonly name: string;
  abstract readonly scoringWindowMs: number;
  abstract readonly cooldownMs: number;
  abstract readonly minSampleSize: number;

  /**
   * F5: Whether this channel adapter has a real implementation.
   * Override to return true once deploy() and getMetrics() are wired
   * to real APIs. The engine skips channels where this returns false.
   */
  isImplemented(): boolean {
    return false;
  }

  /**
   * Deploy a template variant to the channel.
   * Returns a DeployResult with a unique ID for later metric retrieval.
   */
  abstract deploy(variant: Template): Promise<DeployResult>;

  /**
   * Pull metrics for a previously deployed variant.
   * Should only be called after the scoring window has elapsed.
   */
  abstract getMetrics(deployId: string): Promise<ChannelMetrics>;

  /**
   * Parse channel-specific program.md into a ChannelConfig.
   */
  abstract parseProgram(programMd: string): ChannelConfig;

  /**
   * F9: Render a template with its variables into final content.
   * Replaces {{variable}} placeholders with actual values.
   * Logs warnings for any unresolved {{...}} placeholders remaining.
   */
  protected renderTemplate(template: Template): string {
    let rendered = template.body;
    for (const [key, value] of Object.entries(template.variables)) {
      rendered = rendered.replaceAll(`{{${key}}}`, value);
    }

    let renderedSubject: string | undefined;
    if (template.subject) {
      renderedSubject = template.subject;
      for (const [key, value] of Object.entries(template.variables)) {
        renderedSubject = renderedSubject.replaceAll(`{{${key}}}`, value);
      }
    }

    // F9: Detect unresolved placeholders
    const combined = renderedSubject ? `${renderedSubject}\n${rendered}` : rendered;
    const unresolved = combined.match(/\{\{[^}]+\}\}/g);
    if (unresolved) {
      log.warn('Unresolved template placeholders detected — these will appear in deployed content', {
        channel: template.channel,
        version: template.version,
        unresolved,
      });
    }

    if (renderedSubject) {
      return `Subject: ${renderedSubject}\n\n${rendered}`;
    }
    return rendered;
  }
}
