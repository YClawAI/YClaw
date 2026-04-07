// ─── Stale Loop Detector ────────────────────────────────────────────────────
//
// Detects when an agent produces the same output 3+ times under the same
// objective, indicating a stale data loop. Auto-pauses the objective and
// publishes an alert event.

import { createHash } from 'node:crypto';
import { createLogger } from '../logging/logger.js';
import type { EventBus } from '../triggers/event.js';
import type { ObjectiveManager } from './objective-manager.js';

const logger = createLogger('stale-loop-detector');

const STALE_THRESHOLD = 3;
const MAX_HISTORY_PER_KEY = 10;

/**
 * Tracks output hashes per (objectiveId, agentId) pair.
 * In-memory — resets on restart, which is acceptable since loops
 * are detected within a single runtime session.
 */
export class StaleLoopDetector {
  /** Map of `objectiveId:agentId` → array of recent output hashes */
  private history = new Map<string, string[]>();

  constructor(
    private eventBus: EventBus,
    private objectiveManager: ObjectiveManager | null = null,
  ) {}

  /**
   * Record an execution result and check for stale loops.
   * Call this after each agent execution that has an objectiveId.
   *
   * @returns true if a stale loop was detected (objective paused)
   */
  async record(opts: {
    objectiveId: string;
    agentId: string;
    taskName: string;
    output: string;
  }): Promise<boolean> {
    const key = `${opts.objectiveId}:${opts.agentId}`;
    const hash = this.hashOutput(opts.output);

    let hashes = this.history.get(key);
    if (!hashes) {
      hashes = [];
      this.history.set(key, hashes);
    }

    hashes.push(hash);

    // Keep bounded history
    if (hashes.length > MAX_HISTORY_PER_KEY) {
      hashes.splice(0, hashes.length - MAX_HISTORY_PER_KEY);
    }

    // Count consecutive identical hashes from the end
    let consecutiveCount = 0;
    for (let i = hashes.length - 1; i >= 0; i--) {
      if (hashes[i] === hash) {
        consecutiveCount++;
      } else {
        break;
      }
    }

    if (consecutiveCount >= STALE_THRESHOLD) {
      logger.warn('Stale loop detected', {
        objectiveId: opts.objectiveId,
        agentId: opts.agentId,
        taskName: opts.taskName,
        consecutiveCount,
      });

      // Clear history first to avoid re-triggering if downstream calls fail
      this.history.delete(key);

      // Pause the objective (best-effort — log and continue if it fails)
      if (this.objectiveManager) {
        try {
          await this.objectiveManager.pause(
            opts.objectiveId,
            `Stale loop detected: agent ${opts.agentId} produced identical output ${consecutiveCount} times on task ${opts.taskName}`,
          );
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          logger.error('Failed to pause objective after stale loop detection', {
            objectiveId: opts.objectiveId, error: msg,
          });
        }
      }

      // Publish alert event (best-effort)
      try {
        await this.eventBus.publish('objective', 'stale_loop_detected', {
          objectiveId: opts.objectiveId,
          agentId: opts.agentId,
          taskName: opts.taskName,
          consecutiveCount,
          message: `Agent ${opts.agentId} produced identical output ${consecutiveCount} times under objective ${opts.objectiveId}. Objective paused.`,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error('Failed to publish stale_loop_detected event', {
          objectiveId: opts.objectiveId, error: msg,
        });
      }

      return true;
    }

    return false;
  }

  /**
   * Clear history for an objective (e.g., when it's resumed after investigation).
   */
  clearObjective(objectiveId: string): void {
    for (const key of this.history.keys()) {
      if (key.startsWith(`${objectiveId}:`)) {
        this.history.delete(key);
      }
    }
  }

  /**
   * Get current loop stats for debugging.
   */
  getStats(): { trackedPairs: number; totalEntries: number } {
    let totalEntries = 0;
    for (const hashes of this.history.values()) {
      totalEntries += hashes.length;
    }
    return { trackedPairs: this.history.size, totalEntries };
  }

  private hashOutput(output: string): string {
    // Normalize whitespace before hashing to avoid false negatives
    const normalized = output.trim().replace(/\s+/g, ' ');
    return createHash('sha256').update(normalized).digest('hex').slice(0, 16);
  }
}
