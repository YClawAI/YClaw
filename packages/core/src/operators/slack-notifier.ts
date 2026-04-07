import { createLogger } from '../logging/logger.js';
import type { OperatorStore } from './operator-store.js';

const logger = createLogger('operator-slack');

const ALERTS_CHANNEL = process.env.YCLAW_ALERTS_CHANNEL || '#yclaw-alerts';

export interface OperatorNotification {
  operatorId: string;
  type: 'cross_dept_requested' | 'cross_dept_decided' | 'lock_preempted'
    | 'task_completed' | 'task_failed' | 'operator_revoked';
  summary: string;
  details?: Record<string, unknown>;
}

/**
 * Notify operators via Slack. Uses existing Slack executor if available.
 * Falls back to logging if Slack is not configured.
 */
export class OperatorSlackNotifier {
  private slackExecutor: { postMessage: (channel: string, text: string) => Promise<void> } | null = null;

  constructor(private readonly operatorStore: OperatorStore) {}

  /** Set the Slack executor (optional — degrades gracefully). */
  setSlackExecutor(executor: { postMessage: (channel: string, text: string) => Promise<void> }): void {
    this.slackExecutor = executor;
  }

  /** Notify an operator. Routes to their Slack channel or falls back to alerts channel. */
  async notify(notification: OperatorNotification): Promise<void> {
    const message = this.formatMessage(notification);

    // Try to find operator's preferred channel
    const operator = await this.operatorStore.getByOperatorId(notification.operatorId);
    const channel = operator?.slackChannelId || operator?.slackUserId;

    if (this.slackExecutor) {
      try {
        if (channel) {
          await this.slackExecutor.postMessage(channel, message);
        }
        // Security events always go to alerts channel
        if (notification.type === 'operator_revoked' || notification.type === 'lock_preempted') {
          await this.slackExecutor.postMessage(ALERTS_CHANNEL, message);
        }
      } catch (err) {
        logger.warn('Slack notification failed', {
          error: err instanceof Error ? err.message : String(err),
          operatorId: notification.operatorId,
          type: notification.type,
        });
      }
    } else {
      logger.info('Slack not configured — notification logged only', {
        operatorId: notification.operatorId,
        type: notification.type,
        summary: notification.summary,
      });
    }
  }

  /** Notify CEO/dept heads about a cross-dept request needing approval. */
  async notifyApprovers(targetDepartment: string, summary: string): Promise<void> {
    if (!this.slackExecutor) return;
    try {
      await this.slackExecutor.postMessage(
        ALERTS_CHANNEL,
        `*Cross-Department Approval Needed*\nDepartment: ${targetDepartment}\n${summary}`,
      );
    } catch (err) {
      logger.warn('Failed to notify approvers', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private formatMessage(notification: OperatorNotification): string {
    const emoji = {
      cross_dept_requested: ':arrow_right:',
      cross_dept_decided: ':white_check_mark:',
      lock_preempted: ':warning:',
      task_completed: ':white_check_mark:',
      task_failed: ':x:',
      operator_revoked: ':no_entry:',
    }[notification.type] || ':bell:';

    return `${emoji} *${notification.type.replace(/_/g, ' ').toUpperCase()}*\n${notification.summary}`;
  }
}
