// ─── Approval Workflow Types ─────────────────────────────────────────────────

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'expired';

export interface ApprovalRequest {
  id: string;
  type: string;
  requiresHuman: boolean;
  requestedBy: {
    agentId: string;
    department: string;
  };
  payload: Record<string, unknown>;
  reasoning: string;
  estimatedCostCents: number;
  riskLevel: RiskLevel;
  status: ApprovalStatus;
  decidedBy: string | null;
  decisionNote: string | null;
  slackMessageTs: string | null;
  slackChannel: string | null;
  requestedAt: string;
  decidedAt: string | null;
  expiresAt: string;
}

export interface ApprovalDecision {
  decision: 'approved' | 'rejected';
  decidedBy: string;
  note?: string;
}

export interface ApprovalGateConfig {
  riskLevel: RiskLevel;
  channel: string;
  requiresHuman: boolean;
}

// ─── Payload Redaction ───────────────────────────────────────────────────────

/** Fields that should be redacted from approval request payloads. */
const SENSITIVE_FIELD_PATTERNS = [
  /token/i, /secret/i, /password/i, /credential/i, /api_key/i, /apikey/i,
  /private_key/i, /privatekey/i, /auth/i, /bearer/i,
];

/**
 * Redact sensitive fields from a payload before persisting to MongoDB.
 * Returns a shallow copy with sensitive string values replaced.
 */
export function redactPayload(payload: Record<string, unknown>): Record<string, unknown> {
  const redacted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    const isSensitive = SENSITIVE_FIELD_PATTERNS.some(p => p.test(key));
    if (isSensitive && typeof value === 'string') {
      redacted[key] = '[REDACTED]';
    } else if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      redacted[key] = redactPayload(value as Record<string, unknown>);
    } else {
      redacted[key] = value;
    }
  }
  return redacted;
}
