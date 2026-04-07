# Operators

Operators are authenticated identities (human or machine) that interact with the
YClaw agent system. Every API call to `/v1/*` requires operator authentication.

Source: `packages/core/src/operators/`

---

## Operator Model

Defined in `types.ts` via Zod schema (`OperatorSchema`).

| Field | Type | Description |
|-------|------|-------------|
| `operatorId` | string | Unique identifier |
| `displayName` | string | Human-readable name |
| `email` | string | Email address (unique) |
| `role` | string | Freeform role label |
| `tier` | OperatorTier | Authorization tier (see below) |
| `roleIds` | string[] | Assigned role IDs |
| `departments` | string[] | Department slugs (`*` = all) |
| `priorityClass` | number | Task scheduling priority (default 50) |
| `crossDeptPolicy` | `request` \| `none` | Cross-department access behavior |
| `apiKeyHash` | string | Argon2id hash of API key |
| `apiKeyPrefix` | string | First 8 chars of key body (for identification) |
| `tailscaleNodeId` | string? | Optional Tailscale node binding |
| `tailscaleIPs` | string[] | Bound Tailscale IPs |
| `limits` | object | Rate limits (see below) |
| `status` | OperatorStatus | Lifecycle state |
| `slackUserId` | string? | Slack user for notifications |
| `slackChannelId` | string? | Slack channel for notifications |
| `openClaw` | object? | OpenClaw agent binding (`agentName`, `instanceLabel`, `webhookUrl`) |
| `invitedBy` | string? | Operator who created the invitation |
| `createdAt` | Date | Creation timestamp |
| `lastActiveAt` | Date? | Last API call |
| `revokedAt` | Date? | Revocation timestamp |
| `revokedReason` | string? | Revocation reason |

---

## 4-Tier RBAC

Authorization is tier-based. Higher numeric value = more privileged.

| Tier | Level | Purpose |
|------|-------|---------|
| `root` | 100 | Full access, bypasses all permission checks |
| `department_head` | 70 | Manages assigned departments |
| `contributor` | 50 | Triggers tasks and reads data in assigned departments |
| `observer` | 10 | Read-only, all write actions denied |

Tier hierarchy is defined in `TIER_HIERARCHY` (`types.ts`).

---

## Operator Lifecycle

```
invited -> active -> suspended -> revoked
```

| Status | Description |
|--------|-------------|
| `invited` | Invitation sent, pending acceptance |
| `active` | Operator accepted invite, can authenticate |
| `suspended` | Temporarily disabled |
| `revoked` | Permanently disabled (includes `revokedAt` and `revokedReason`) |

---

## Permission Engine

Source: `permission-engine.ts`

The `evaluatePermission()` function determines whether an operator can perform a
given action on a resource. It accepts the operator, their resolved roles, a
`PermissionCheck` (operatorId, action, resourceType, resourceId), and an optional
agent-to-department map.

### Evaluation Order

1. **Root bypass** -- If `operator.tier === 'root'`, always allowed. Reason: `root_access`.
2. **Observer deny** -- If `operator.tier === 'observer'` and the action is a write action, always denied. Reason: `denied_observer`.
3. **Role grants** -- Aggregates grants from ALL assigned roles. Matches on `resourceType`, `resourceId` (exact or `*` wildcard), and `actions` (exact or `*` wildcard). If any grant matches, allowed. Reason: `role_grant`.
4. **Department match** -- If the operator's departments include the target department (resolved from the resource), and the action is a standard action, allowed. Wildcard departments (`*`) also checked. Reason: `department_match`.
5. **Default deny** -- No match found. Reason: `denied_no_grant`.

### Write Actions (observers always denied)

`trigger`, `cancel`, `approve`, `create`, `update`, `delete`

### Standard Department Actions (no explicit grant needed)

`read`, `trigger`, `cancel_own`

Non-standard actions within an operator's own department still require an
explicit role grant.

### PermissionResult

```typescript
interface PermissionResult {
  allowed: boolean;
  reason: 'root_access' | 'role_grant' | 'department_match' | 'denied_no_grant' | 'denied_observer';
  effectiveGrants: Grant[];
}
```

---

## Roles

Source: `roles.ts`

### Grant Schema

Each role contains an array of grants:

```typescript
{
  resourceType: 'department' | 'agent' | 'task' | 'operator' | 'audit';
  resourceId: string;   // exact ID or '*' for wildcard
  actions: string[];    // action names or '*' for all
}
```

### Role Fields

| Field | Type | Description |
|-------|------|-------------|
| `roleId` | string | Unique identifier |
| `name` | string | Display name |
| `description` | string? | Description |
| `grants` | Grant[] | Resource-action permissions |
| `priorityClass` | number | Task priority weight |
| `canManageOperators` | boolean | Can invite/revoke operators |
| `canApproveDeployments` | boolean | Can approve deploys |

### Default Roles

Seeded on startup via `RoleStore.seedDefaults()` (upsert, won't overwrite existing).

| roleId | Name | Grants | Priority | Manage Ops | Approve Deploys |
|--------|------|--------|----------|------------|-----------------|
| `role_ceo` | CEO / Org Admin | `department:*:*` (all) | 100 | Yes | Yes |
| `role_department_head` | Department Head | (none, uses dept match) | 70 | No | No |
| `role_contributor` | Contributor | (none, uses dept match) | 50 | No | No |
| `role_observer` | Observer | (none, read-only via tier) | 10 | No | No |

### Tier-to-Role Mapping

`RoleStore.getRoleForTier()` maps:
- `root` -> `role_ceo`
- `department_head` -> `role_department_head`
- `contributor` -> `role_contributor`
- `observer` -> `role_observer`

---

## API Keys

Source: `api-keys.ts`

### Key Format

- Prefix: `gzop_live_`
- Body: 32 bytes of `crypto.randomBytes`, base64url-encoded
- Full key example: `gzop_live_<43 base64url chars>`
- Stored prefix: first 8 characters of the body (for key identification in logs)

### Key Storage

API keys are hashed with **argon2id** before storage. The raw key is returned
exactly once at generation time and never stored.

- `generateApiKey()` -- returns `{ key, prefix, hash }`
- `verifyApiKey(key, storedHash)` -- constant-time argon2 verification
- `extractKeyPrefix(key)` -- extracts the 8-char prefix from a raw key

### Invitation Tokens

- Prefix: `gzinv_`
- Body: 48 bytes of `crypto.randomBytes`, base64url-encoded
- Hashed with **SHA-256** (not argon2id) for fast lookup -- these are single-use,
  high-entropy tokens where lookup speed matters more than brute-force resistance

Functions:
- `generateInviteToken()` -- returns `{ token, hash }`
- `hashInviteToken(token)` -- SHA-256 for lookup

---

## Invitation System

Source: `types.ts` (`InvitationSchema`)

Operators are onboarded via invitations created by existing operators.

### Invitation Fields

| Field | Type | Description |
|-------|------|-------------|
| `invitationId` | string | Unique ID |
| `email` | string | Invitee email |
| `intendedDisplayName` | string | Pre-set display name |
| `intendedRole` | string | Pre-set role label |
| `intendedTier` | OperatorTier | Pre-set tier |
| `intendedDepartments` | string[] | Pre-set departments |
| `intendedLimits` | object? | Pre-set rate limits |
| `tokenHash` | string | SHA-256 hash of invite token |
| `status` | `pending` \| `accepted` \| `expired` \| `revoked` | Invitation state |
| `createdBy` | string | Inviting operator ID |
| `expiresAt` | Date | Expiration timestamp |

### Acceptance Flow

`AcceptInviteInput` requires the raw `inviteToken` and optionally accepts
`agentName`, `tailscaleNodeId`, and `instanceLabel` for OpenClaw binding.

---

## Tailscale Node Binding

Operators can optionally bind to a Tailscale node via `tailscaleNodeId` and
`tailscaleIPs`. When set, API requests can be validated against the Tailscale
identity of the connecting node, providing network-layer authentication on top
of the API key.

---

## Rate Limits

Per-operator rate limits defined in `OperatorSchema.limits`:

| Limit | Default | Description |
|-------|---------|-------------|
| `requestsPerMinute` | 60 | API requests per minute |
| `maxConcurrentTasks` | 5 | Concurrent running tasks |
| `dailyTaskQuota` | 100 | Total tasks per day |

Limits can be customized per-operator at invitation time or updated later.

---

## Audit Logging

Source: `audit-logger.ts`

Every operator action (allowed or denied) is logged to the `operator_audit_logs`
MongoDB collection.

### Audit Entry

```typescript
interface OperatorAuditEntry {
  timestamp: Date;
  operatorId: string;
  action: string;
  departmentId?: string;
  resource: { type: string; id: string };
  request: { method: string; path: string; ip: string };
  decision: 'allowed' | 'denied';
  reason?: string;
}
```

### Storage

- MongoDB collection: `operator_audit_logs`
- TTL: **90 days** (auto-deleted via MongoDB TTL index on `timestamp`)
- Indexes: `timestamp`, `operatorId`, `action`, `resource.type + resource.id`
- Write method: fire-and-forget (`log()` is synchronous to the caller, async insert)

### Query Methods

| Method | Description |
|--------|-------------|
| `getByOperator(id, limit?)` | Logs for a specific operator (default 100) |
| `getRecent(limit?)` | Recent logs across all operators |
| `queryFiltered(params)` | Filtered by operatorId, action, department, date range |

`queryFiltered` supports all filter combinations:

```typescript
await auditLogger.queryFiltered({
  operatorId: 'op_123',
  action: 'trigger',
  department: 'development',
  from: new Date('2026-03-01'),
  to: new Date('2026-04-01'),
  limit: 50,
});
```
