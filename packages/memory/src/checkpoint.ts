/**
 * Memory Architecture — Checkpoint Module (Phase 2)
 * Session crash recovery and replay.
 * Serializes execution state after every agent turn.
 * Expected retention is 24 hours when cleanupExpiredCheckpoints() is scheduled.
 */

import type { Pool } from 'pg';

export interface CheckpointData {
  userInput?: unknown;
  toolCalls?: unknown;
  llmOutput?: unknown;
  internalState?: unknown;
}

export interface Checkpoint {
  id: string;
  agentId: string;
  sessionId: string;
  turnNumber: number;
  userInput: unknown;
  toolCalls: unknown;
  llmOutput: unknown;
  internalState: unknown;
  createdAt: Date;
}

/**
 * Save a checkpoint after an agent turn.
 */
export async function saveCheckpoint(
  pool: Pool,
  agentId: string,
  sessionId: string,
  turnNumber: number,
  data: CheckpointData,
): Promise<void> {
  await pool.query(
    `INSERT INTO checkpoints (agent_id, session_id, turn_number, user_input, tool_calls, llm_output, internal_state)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (session_id, turn_number)
     DO UPDATE SET user_input = $4, tool_calls = $5, llm_output = $6, internal_state = $7`,
    [
      agentId,
      sessionId,
      turnNumber,
      JSON.stringify(data.userInput ?? null),
      JSON.stringify(data.toolCalls ?? null),
      JSON.stringify(data.llmOutput ?? null),
      JSON.stringify(data.internalState ?? null),
    ],
  );
}

/**
 * Get the latest checkpoint for a session (for crash recovery).
 */
export async function getLatestCheckpoint(
  pool: Pool,
  sessionId: string,
): Promise<Checkpoint | null> {
  const result = await pool.query(
    `SELECT * FROM checkpoints
     WHERE session_id = $1
     ORDER BY turn_number DESC
     LIMIT 1`,
    [sessionId],
  );

  if (result.rows.length === 0) return null;

  const row = result.rows[0];
  return {
    id: row.id,
    agentId: row.agent_id,
    sessionId: row.session_id,
    turnNumber: row.turn_number,
    userInput: row.user_input,
    toolCalls: row.tool_calls,
    llmOutput: row.llm_output,
    internalState: row.internal_state,
    createdAt: row.created_at,
  };
}

/**
 * Get a specific checkpoint by turn number (for replay).
 */
export async function getCheckpoint(
  pool: Pool,
  sessionId: string,
  turnNumber: number,
): Promise<Checkpoint | null> {
  const result = await pool.query(
    `SELECT * FROM checkpoints
     WHERE session_id = $1 AND turn_number = $2`,
    [sessionId, turnNumber],
  );

  if (result.rows.length === 0) return null;

  const row = result.rows[0];
  return {
    id: row.id,
    agentId: row.agent_id,
    sessionId: row.session_id,
    turnNumber: row.turn_number,
    userInput: row.user_input,
    toolCalls: row.tool_calls,
    llmOutput: row.llm_output,
    internalState: row.internal_state,
    createdAt: row.created_at,
  };
}

/**
 * Get all checkpoints for a session (full replay).
 */
export async function getSessionCheckpoints(
  pool: Pool,
  sessionId: string,
): Promise<Checkpoint[]> {
  const result = await pool.query(
    `SELECT * FROM checkpoints
     WHERE session_id = $1
     ORDER BY turn_number ASC`,
    [sessionId],
  );

  return result.rows.map(row => ({
    id: row.id,
    agentId: row.agent_id,
    sessionId: row.session_id,
    turnNumber: row.turn_number,
    userInput: row.user_input,
    toolCalls: row.tool_calls,
    llmOutput: row.llm_output,
    internalState: row.internal_state,
    createdAt: row.created_at,
  }));
}

/**
 * Delete checkpoints older than TTL (default 24h).
 * Called by application-level scheduler.
 */
export async function cleanupExpiredCheckpoints(
  pool: Pool,
  ttlHours = 24,
): Promise<number> {
  const result = await pool.query(
    `DELETE FROM checkpoints
     WHERE created_at < now() - make_interval(hours => $1)`,
    [ttlHours],
  );
  return result.rowCount ?? 0;
}

/**
 * Delete all checkpoints for a session (called at session end after flush).
 */
export async function clearSessionCheckpoints(
  pool: Pool,
  sessionId: string,
): Promise<number> {
  const result = await pool.query(
    `DELETE FROM checkpoints WHERE session_id = $1`,
    [sessionId],
  );
  return result.rowCount ?? 0;
}
