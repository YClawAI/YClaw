import type { Redis as IORedis } from 'ioredis';
import { createLogger } from '../logging/logger.js';
import {
  CHECKPOINT_TTL_SECONDS,
  CHECKPOINT_MAX_PARTIAL_RESULT,
  type Checkpoint,
  type CheckpointState,
} from './types.js';

const logger = createLogger('checkpoint');

function redisKey(agentId: string, taskKey: string): string {
  return `checkpoint:${agentId}:${taskKey}`;
}

export class CheckpointManager {
  constructor(private redis: IORedis | null) {}

  get hasRedis(): boolean {
    return this.redis !== null;
  }

  async save(checkpoint: Checkpoint): Promise<boolean> {
    if (!this.redis) return false;

    // Truncate partialResult to 4KB
    const truncated: Checkpoint = {
      ...checkpoint,
      partialResult: checkpoint.partialResult.slice(0, CHECKPOINT_MAX_PARTIAL_RESULT),
    };

    const key = redisKey(checkpoint.agentId, checkpoint.taskKey);
    try {
      await this.redis.set(key, JSON.stringify(truncated), 'EX', CHECKPOINT_TTL_SECONDS);
      logger.info(`Checkpoint saved: ${checkpoint.agentId}:${checkpoint.taskKey}`, {
        state: checkpoint.state,
        toolCallsCompleted: checkpoint.toolCallsCompleted,
      });
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(`Checkpoint save failed (non-fatal): ${msg}`);
      return false;
    }
  }

  async get(agentId: string, taskKey: string): Promise<Checkpoint | null> {
    if (!this.redis) return null;

    const key = redisKey(agentId, taskKey);
    try {
      const raw = await this.redis.get(key);
      if (!raw) return null;

      const checkpoint = JSON.parse(raw) as Checkpoint;

      // Check staleness — if older than TTL or unparseable date, treat as expired
      const checkpointTime = new Date(checkpoint.checkpointedAt).getTime();
      const age = Number.isNaN(checkpointTime) ? Infinity : Date.now() - checkpointTime;
      if (age > CHECKPOINT_TTL_SECONDS * 1000) {
        logger.info(`Checkpoint expired (${Math.round(age / 1000)}s old), deleting`, {
          agentId, taskKey,
        });
        await this.delete(agentId, taskKey);
        return null;
      }

      return checkpoint;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(`Checkpoint read failed (non-fatal): ${msg}`);
      return null;
    }
  }

  async delete(agentId: string, taskKey: string): Promise<void> {
    if (!this.redis) return;

    const key = redisKey(agentId, taskKey);
    try {
      await this.redis.del(key);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(`Checkpoint delete failed (non-fatal): ${msg}`);
    }
  }
}
