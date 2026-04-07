/**
 * Memory Architecture — Postgres Client
 * Thin wrapper around pg with connection management and RLS session setup.
 */

import { Pool, type PoolClient, type QueryResult } from 'pg';
import type { MemoryConfig } from '../types.js';

let pool: Pool | null = null;

export function getPool(config: MemoryConfig['postgres']): Pool {
  if (!pool) {
    pool = new Pool({
      host: config.host,
      port: config.port,
      database: config.database,
      user: config.user,
      password: config.password,
      ssl: config.ssl ? { rejectUnauthorized: false } : undefined,
      min: 2,
      max: 5,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });

    pool.on('error', (err) => {
      console.error('[memory:pg] Unexpected pool error:', err.message);
    });
  }
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

/**
 * Set RLS session variables using set_config() which supports parameterized $1.
 * The third argument `true` makes it LOCAL (transaction-scoped).
 */
async function setRlsContext(
  client: PoolClient,
  context: { agentId: string; departmentId?: string; role?: string },
): Promise<void> {
  await client.query("SELECT set_config('app.agent_id', $1, true)", [context.agentId]);
  if (context.departmentId) {
    await client.query("SELECT set_config('app.department_id', $1, true)", [context.departmentId]);
  }
  if (context.role) {
    await client.query("SELECT set_config('app.role', $1, true)", [context.role]);
  }
}

/**
 * Execute a query with RLS context set for the given agent.
 */
export async function query(
  pool: Pool,
  sql: string,
  params: unknown[] = [],
  context?: { agentId: string; departmentId?: string; role?: string },
): Promise<QueryResult> {
  const client = await pool.connect();
  try {
    if (context) {
      await setRlsContext(client, context);
    }
    return await client.query(sql, params);
  } finally {
    client.release();
  }
}

/**
 * Execute multiple operations in a transaction with RLS context.
 */
export async function withTransaction<T>(
  pool: Pool,
  context: { agentId: string; departmentId?: string; role?: string },
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await setRlsContext(client, context);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
