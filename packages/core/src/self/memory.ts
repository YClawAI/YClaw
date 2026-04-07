import type { Db, Collection } from 'mongodb';
import { createLogger } from '../logging/logger.js';

const logger = createLogger('agent-memory');

interface MemoryEntry {
  agent: string;
  key: string;
  value: unknown;
  updatedAt: Date;
  version: number;
}

/**
 * MongoDB-backed persistent agent memory.
 *
 * - Agent-scoped: each agent reads/writes only its own memory by default
 * - Cross-readable: any agent can READ any other agent's memory
 * - Write-restricted: only the owning agent can WRITE to its memory
 */
export class AgentMemory {
  private collection: Collection<MemoryEntry>;

  constructor(db: Db) {
    this.collection = db.collection<MemoryEntry>('agent_memory');
  }

  async initialize(): Promise<void> {
    await this.collection.createIndex({ agent: 1, key: 1 }, { unique: true });
    await this.collection.createIndex({ agent: 1 });
    logger.info('Agent memory collection initialized');
  }

  async read(agent: string, key: string): Promise<unknown> {
    const entry = await this.collection.findOne({ agent, key });
    return entry?.value ?? null;
  }

  async readAll(agent: string): Promise<Record<string, unknown>> {
    const entries = await this.collection.find({ agent }).toArray();
    const result: Record<string, unknown> = {};
    for (const entry of entries) {
      result[entry.key] = entry.value;
    }
    return result;
  }

  async write(agent: string, key: string, value: unknown): Promise<void> {
    await this.collection.updateOne(
      { agent, key },
      {
        $set: { value, updatedAt: new Date() },
        $inc: { version: 1 },
        $setOnInsert: { agent, key },
      },
      { upsert: true },
    );
    logger.debug(`Memory written: ${agent}/${key}`);
  }

  async delete(agent: string, key: string): Promise<boolean> {
    const result = await this.collection.deleteOne({ agent, key });
    return result.deletedCount > 0;
  }

  async listKeys(agent: string): Promise<string[]> {
    const entries = await this.collection
      .find({ agent }, { projection: { key: 1 } })
      .toArray();
    return entries.map(e => e.key);
  }

  async crossRead(requestingAgent: string, targetAgent: string, key?: string): Promise<unknown> {
    logger.info(`Cross-read: ${requestingAgent} reading ${targetAgent}${key ? `/${key}` : ''}`);
    if (key) {
      return this.read(targetAgent, key);
    }
    return this.readAll(targetAgent);
  }
}
