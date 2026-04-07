/**
 * YCLAW Security Audit Logger
 *
 * Every agent action produces an immutable audit record.
 * Records are stored in MongoDB with TTL indexing.
 */

export interface AuditEntry {
  timestamp: string;
  agentId: string;
  action: string;
  target: string;
  decision: 'allowed' | 'blocked' | 'escalated';
  reason?: string;
  changedFiles?: string[];
  costUSD?: number;
}

export function createAuditEntry(
  agentId: string,
  action: string,
  target: string,
  decision: AuditEntry['decision'],
  extra?: Partial<Pick<AuditEntry, 'reason' | 'changedFiles' | 'costUSD'>>,
): AuditEntry {
  return {
    timestamp: new Date().toISOString(),
    agentId,
    action,
    target,
    decision,
    ...extra,
  };
}
