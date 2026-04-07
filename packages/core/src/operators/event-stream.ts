import type { Db, Collection, Filter } from 'mongodb';
import { createLogger } from '../logging/logger.js';

const logger = createLogger('operator-events');

// Monotonic sequence counter for sub-millisecond ordering
let sequence = 0;
let lastTimestamp = 0;

function generateMonotonicId(): string {
  const now = Date.now();
  if (now === lastTimestamp) {
    sequence++;
  } else {
    sequence = 0;
    lastTimestamp = now;
  }
  // Zero-padded timestamp + sequence = always sortable by string comparison
  return `evt_${String(now).padStart(15, '0')}_${String(sequence).padStart(6, '0')}`;
}

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface OperatorEvent {
  eventId: string;
  timestamp: Date;
  type: string;
  departmentId: string;
  agentId?: string;
  operatorId?: string;
  summary: string;
  details: Record<string, unknown>;
}

// ─── Store ─────────────────────────────────────────────────────────────────────

export class OperatorEventStream {
  private readonly collection: Collection<OperatorEvent>;

  constructor(db: Db) {
    this.collection = db.collection<OperatorEvent>('operator_events');
  }

  async ensureIndexes(): Promise<void> {
    await this.collection.createIndex({ eventId: 1 });
    await this.collection.createIndex({ departmentId: 1 });
    await this.collection.createIndex({ timestamp: -1 });
    await this.collection.createIndex({ type: 1 });
    // TTL: auto-delete after 7 days
    await this.collection.createIndex(
      { timestamp: 1 },
      { expireAfterSeconds: 7 * 24 * 60 * 60, name: 'ttl_7d' },
    );
    logger.info('Operator event stream indexes ensured');
  }

  /** Emit an event. Fire-and-forget safe. */
  emit(event: Omit<OperatorEvent, 'eventId' | 'timestamp'>): void {
    const full: OperatorEvent = {
      eventId: generateMonotonicId(),
      timestamp: new Date(),
      ...event,
    };
    this.collection.insertOne(full as any).catch((err) => {
      logger.error('Failed to emit event', {
        error: err instanceof Error ? err.message : String(err),
        type: event.type,
      });
    });
  }

  /** Query events with cursor-based pagination. Sorted ascending by eventId for correct cursor semantics. */
  async query(params: {
    since?: string;
    departmentIds?: string[];
    type?: string;
    limit?: number;
  }): Promise<OperatorEvent[]> {
    const query: Record<string, unknown> = {};

    if (params.since) {
      query.eventId = { $gt: params.since };
    }

    if (params.departmentIds?.length) {
      query.departmentId = { $in: params.departmentIds };
    }

    if (params.type) {
      query.type = params.type;
    }

    // Sort ascending by eventId (monotonic) for correct cursor pagination
    return this.collection
      .find(query as Filter<OperatorEvent>)
      .sort({ eventId: 1 })
      .limit(params.limit ?? 50)
      .toArray() as Promise<OperatorEvent[]>;
  }
}
