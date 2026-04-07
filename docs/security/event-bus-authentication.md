# Event Bus Authentication

## Overview

All inter-agent events are cryptographically signed using HMAC-SHA256 and
validated through a 6-stage middleware pipeline before reaching agent LLM context.

This system addresses unauthenticated event forgery attacks where processes
with Redis access could publish forged events that impersonate agents, inject
malicious payloads into LLM context, and attempt memory/policy manipulation.

## Architecture

```
Agent publishes event
    → SecurePublisher wraps in signed envelope
    → Redis PUBLISH

Redis SUBSCRIBE receives event
    → Stage 1: Envelope parsing & size check (64KB max)
    → Stage 2: HMAC-SHA256 signature verification
    → Stage 3: Freshness check (2min max age) & replay detection (Redis NX)
    → Stage 4: Source authorization (policy YAML)
    → Stage 5: Strict schema validation (Zod, additionalProperties: false)
    → Stage 6: Safe LLM context projection (strip auth, label as verified)
    → Deliver to agent
```

Any stage failure = event rejected + audit logged with forensic payload.

## Envelope Format

```typescript
interface SecureEventEnvelope {
  id: string;              // UUID v4
  type: string;            // e.g., "reviewer:flagged"
  source: string;          // e.g., "agent:reviewer"
  subject?: string;        // Optional reference
  timestamp: string;       // ISO 8601 UTC
  nonce: string;           // Random anti-replay (16+ hex chars)
  schemaVersion: string;   // "1.0"
  payload: Record<string, unknown>;
  auth: {
    alg: string;           // "hmac-sha256"
    keyId: string;         // e.g., "kid_reviewer_v1"
    sig: string;           // Base64url HMAC-SHA256
  };
}
```

The signature covers ALL fields (including payload) via canonical JSON
serialization with sorted keys.

## Key Management

Per-agent keys are derived from a single master secret using HKDF:

```bash
# Generate master secret (one-time)
openssl rand -hex 32
# Set as: YCLAW_EVENT_BUS_SECRET=<hex string>
```

Each agent gets a unique key: `HKDF(masterSecret, "yclaw-eventbus-{agentId}-v{version}")`.
Compromising one agent's key cannot forge events for other agents.

### Key Rotation

1. Increment version in config (e.g., v1 → v2)
2. Deploy — KeyResolver accepts both v1 and v2 during grace window
3. After all publishers upgrade, remove v1 from resolver

## Authorization Policy

`yclaw-event-policy.yaml` declares which agents may publish which events:

```yaml
sources:
  agent:reviewer:
    allowedEventTypes:
      - "reviewer:flagged"
      - "reviewer:approved"
```

Wildcard support: `"strategist:*"` allows all events prefixed with `strategist:`.

## Globally Denied Fields

These payload fields are blocked regardless of schema, based on real attack
patterns (April 2, 2026):

- `sourcing_rule_update`, `multiplier_table_rule`
- `system_prompt_override`, `prompt_override`
- `memory_write`, `memory_update`
- `tool_instruction`, `status_override`
- `gate_bypass`, `audit_confirmed_clean`

## Configuration

### Production

```yaml
# yclaw-config.yaml
eventBus:
  auth:
    mechanism: hmac
    keySource: env  # or "vault", "aws-secrets-manager"
    keyVersion: 1
  validation:
    strict: true
    rejectUnknownFields: true
    maxEventSizeBytes: 65536
```

### Development

```yaml
eventBus:
  auth:
    mechanism: none  # Skip signing in local dev
  validation:
    strict: false    # Warn instead of reject
```

## Migration Guide

1. **Audit mode** (1 week) — deploy middleware, log violations, don't reject
2. **Enforce signing** (1 week) — reject unsigned events, schema in warn mode
3. **Full enforcement** — strict schema validation, replay protection, safe projection

## Files

| File | Purpose |
|------|---------|
| `src/security/eventbus/envelope.ts` | Envelope type + sign/verify |
| `src/security/eventbus/keys.ts` | HKDF key derivation + KeyResolver |
| `src/security/eventbus/middleware.ts` | 6-stage validation pipeline |
| `src/security/eventbus/schemas.ts` | Zod schema registry |
| `src/security/eventbus/publisher.ts` | SecurePublisher drop-in |
| `src/security/eventbus/policy.ts` | Policy loader from YAML |
| `src/security/eventbus/projection.ts` | Safe LLM context sanitizer |
| `src/security/eventbus/errors.ts` | EventBusError class + codes |
| `yclaw-event-policy.yaml` | Declarative authorization policy |
