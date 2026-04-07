import { createLogger } from '../logging/logger.js';
import type { AgentHubClient } from '../agenthub/client.js';
import type { ChannelConfig, ScoreResult, ExperimentResult } from './types.js';
import type { BaseChannel } from './channels/base-channel.js';

const log = createLogger('growth-engine:scorer');

// ─── Scorer ───────────────────────────────────────────────────────────────────

/**
 * Pulls metrics after the scoring window, computes normalized score,
 * and posts results to the AgentHub message board.
 *
 * F2: Uses absolute percentage-point difference (not relative percent lift)
 *     to match spec's "by >= X percentage points" threshold.
 * F3: When championScore is -1 (no score yet), first scored variant auto-wins.
 * F6: Enforces minSampleSize before declaring a winner.
 */
export class Scorer {
  constructor(
    private readonly agentHub: AgentHubClient,
    private readonly channels: Map<string, BaseChannel>,
  ) {}

  /**
   * Score a deployed variant by pulling metrics from the channel.
   *
   * @param channelConfig - The channel configuration
   * @param deployId - Deployment ID from the deploy step
   * @param championScore - Current champion's score (-1 = no champion yet)
   */
  async score(
    channelConfig: ChannelConfig,
    deployId: string,
    championScore: number,
  ): Promise<ScoreResult> {
    const channel = this.channels.get(channelConfig.name);
    if (!channel) {
      throw new Error(`Channel adapter not found: ${channelConfig.name}`);
    }

    log.info('Pulling metrics', {
      channel: channelConfig.name,
      deployId,
      metric: channelConfig.scoringMetric,
    });

    const metrics = await channel.getMetrics(deployId);

    const scoreValue = metrics.primaryMetric;

    // F2: Absolute percentage-point difference, not relative percent
    // Spec says "by >= 0.5 percentage points" — so 2.0% → 2.5% = +0.5 pp (passes)
    // NOT relative: (2.5-2.0)/2.0 * 100 = 25% (would wrongly inflate)
    const lift = championScore >= 0 ? scoreValue - championScore : scoreValue;

    // F3: If champion has no score yet (-1), first scored variant auto-wins
    const isFirstScore = championScore < 0;

    // F6: Enforce minimum sample size before declaring a winner
    const hasMinSamples = metrics.sampleSize >= channelConfig.minSampleSize;

    // F2: Use >= (not >) to match spec's ">= 0.5 percentage points"
    const beatsThreshold = lift >= channelConfig.winThreshold;

    const isWinner = isFirstScore
      ? true // First experiment always becomes the baseline champion
      : (hasMinSamples && beatsThreshold);

    if (!hasMinSamples && !isFirstScore && beatsThreshold) {
      log.warn('Variant beats threshold but insufficient sample size — not declaring winner', {
        channel: channelConfig.name,
        sampleSize: metrics.sampleSize,
        minRequired: channelConfig.minSampleSize,
        lift: lift.toFixed(4),
      });
    }

    const result: ScoreResult = {
      value: scoreValue,
      lift,
      metrics,
      isWinner,
    };

    log.info('Scoring complete', {
      channel: channelConfig.name,
      deployId,
      score: scoreValue,
      lift: `${lift.toFixed(4)} pp`,
      isWinner,
      championScore,
      sampleSize: metrics.sampleSize,
      minSampleSize: channelConfig.minSampleSize,
    });

    return result;
  }

  /**
   * Post experiment result to AgentHub message board.
   */
  async postResult(result: ExperimentResult): Promise<void> {
    const emoji = result.isWinner ? '+++' : '---';
    const liftStr = result.lift > 0 ? `+${result.lift.toFixed(4)} pp` : `${result.lift.toFixed(4)} pp`;

    const content = [
      `${emoji} ${result.channel}/v${result.version}`,
      `Variable: ${result.mutationVariable ?? 'initial'}`,
      `Description: ${result.mutationDescription ?? 'champion baseline'}`,
      `Score: ${result.score.toFixed(4)} (${liftStr} vs champion)`,
      `Decision: ${result.isWinner ? 'WINNER' : 'DISCARD'}`,
      `Deploy: ${result.deployId}`,
      `Scored: ${result.scoredAt}`,
    ].join('\n');

    await this.agentHub.createPost('experiment-results', content).catch((err) => {
      log.warn('Failed to post experiment result', { error: (err as Error).message });
    });
  }
}
