import { getDb } from '@/lib/mongodb';
import { randomUUID } from 'crypto';

// ── Types ────────────────────────────────────────────────────────────────────

export interface ConnectionStep {
  id: string;
  label: string;
  actor: 'human' | 'openclaw' | 'fleet' | 'system';
  status: 'pending' | 'active' | 'complete' | 'failed' | 'skipped';
  detail?: string;
}

export interface ConnectionSession {
  _id: string;
  integration: string;
  tier: 1 | 2 | 3;
  status:
    | 'pending'
    | 'collecting_credentials'
    | 'storing'
    | 'wiring'
    | 'verifying'
    | 'connected'
    | 'failed';
  steps: ConnectionStep[];
  credentials: {
    secretRef?: string;
    /** Per-field scoped secret refs: { fieldKey: "integrations/{name}/{field}" } */
    fieldRefs?: Record<string, string>;
    storedAt?: Date;
    verified?: boolean;
  };
  /** Tier 3 metadata: provider docs URL, org context, repo lists, etc. */
  metadata?: Record<string, unknown>;
  error?: string;
  createdAt: Date;
  updatedAt: Date;
}

/** Thrown when getDb() returns null so callers can distinguish DB outages from not-found. */
export class DatabaseUnavailableError extends Error {
  constructor() {
    super('Database unavailable');
    this.name = 'DatabaseUnavailableError';
  }
}

const COLLECTION = 'connection_sessions';
const SECRETS_COLLECTION = 'integration_secrets';
const ORG_SETTINGS_COLLECTION = 'org_settings';

// ── Safety Gates ─────────────────────────────────────────────────────────────

/**
 * Check if an integration is allowed by the org's integration allowlist.
 * Returns true if allowed, false if blocked.
 * Default: all integrations allowed ('*' wildcard).
 */
export async function isIntegrationAllowed(integrationId: string): Promise<boolean> {
  const db = await getDb();
  if (!db) return true; // Fail open if DB unavailable

  const settings = await db.collection(ORG_SETTINGS_COLLECTION).findOne({ _id: 'default' as any });
  const allowedList: string[] | undefined = (settings as any)?.allowed_integrations;

  // No list or wildcard means everything is allowed
  if (!allowedList || allowedList.includes('*')) return true;

  return allowedList.includes(integrationId);
}

/**
 * Check if an integration is enabled via circuit breaker.
 * Feature flag: integration_{name}_enabled in org_settings.
 * Default: true (enabled).
 */
export async function isIntegrationEnabled(integrationId: string): Promise<boolean> {
  const db = await getDb();
  if (!db) return true; // Fail open if DB unavailable

  const settings = await db.collection(ORG_SETTINGS_COLLECTION).findOne({ _id: 'default' as any });
  const flagKey = `integration_${integrationId}_enabled`;
  const flag = (settings as any)?.[flagKey];

  // Undefined means enabled by default
  return flag !== false;
}

/**
 * Toggle the circuit breaker for an integration.
 */
export async function setIntegrationEnabled(integrationId: string, enabled: boolean): Promise<void> {
  const db = await getDb();
  if (!db) throw new DatabaseUnavailableError();

  const flagKey = `integration_${integrationId}_enabled`;
  await db.collection(ORG_SETTINGS_COLLECTION).updateOne(
    { _id: 'default' as any },
    { $set: { [flagKey]: enabled, updatedAt: new Date() } },
    { upsert: true },
  );
}

// ── Secret Backend (pluggable via SECRET_BACKEND env var) ────────────────────

import type { SecretBackend } from '@yclaw/core';

let _backend: SecretBackend | null = null;

async function getBackend(): Promise<SecretBackend> {
  if (_backend) return _backend;
  const { resolveSecretBackend } = await import('@yclaw/core');
  _backend = await resolveSecretBackend();
  return _backend;
}

// ── Session CRUD ─────────────────────────────────────────────────────────────

export async function createSession(
  integration: string,
  tier: 1 | 2 | 3,
  steps: ConnectionStep[],
  initialStatus: ConnectionSession['status'] = 'collecting_credentials',
  metadata?: Record<string, unknown>,
): Promise<ConnectionSession> {
  const db = await getDb();
  if (!db) throw new DatabaseUnavailableError();

  const session: ConnectionSession = {
    _id: randomUUID(),
    integration,
    tier,
    status: initialStatus,
    steps,
    credentials: {},
    metadata,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  await db.collection(COLLECTION).insertOne(session as any);
  return session;
}

export async function getSession(id: string): Promise<ConnectionSession | null> {
  const db = await getDb();
  if (!db) throw new DatabaseUnavailableError();
  return db.collection<ConnectionSession>(COLLECTION).findOne({ _id: id as any }) as Promise<ConnectionSession | null>;
}

export async function listSessions(): Promise<ConnectionSession[]> {
  const db = await getDb();
  if (!db) throw new DatabaseUnavailableError();
  return db
    .collection<ConnectionSession>(COLLECTION)
    .find()
    .sort({ updatedAt: -1 })
    .toArray() as Promise<ConnectionSession[]>;
}

export async function updateSession(
  id: string,
  update: Partial<Pick<ConnectionSession, 'status' | 'steps' | 'credentials' | 'error' | 'metadata'>>,
): Promise<void> {
  const db = await getDb();
  if (!db) throw new DatabaseUnavailableError();

  await db.collection(COLLECTION).updateOne(
    { _id: id as any },
    { $set: { ...update, updatedAt: new Date() } },
  );
}

// ── Secret Storage (delegates to pluggable SecretBackend) ────────────────────

/**
 * Store credentials via the configured secret backend.
 * Returns a session-scoped groupId and per-field refs.
 */
export async function storeSecret(
  integration: string,
  fields: Record<string, string>,
): Promise<{ groupId: string; fieldRefs: Record<string, string> }> {
  const backend = await getBackend();
  const groupId = await backend.store(integration, fields);

  // Build session-scoped field refs using the groupId to avoid overwrites
  const fieldRefs: Record<string, string> = {};
  for (const key of Object.keys(fields)) {
    if (fields[key]) {
      fieldRefs[key] = `integrations/${integration}/${groupId}/${key}`;
    }
  }

  return { groupId, fieldRefs };
}

export async function deleteSecret(secretRef: string): Promise<void> {
  const backend = await getBackend();
  await backend.delete(secretRef);
}

/**
 * Get a single credential field by scoped ref.
 */
export async function getSecretField(
  scopedRef: string,
): Promise<string | null> {
  const backend = await getBackend();
  return backend.retrieveField(scopedRef);
}

/**
 * Get all credential fields for a secret group.
 */
export async function getSecret(
  secretRef: string,
): Promise<Record<string, string> | null> {
  const backend = await getBackend();
  return backend.retrieve(secretRef);
}
