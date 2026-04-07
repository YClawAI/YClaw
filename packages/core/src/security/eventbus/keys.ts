/**
 * HKDF Key Derivation for Event Bus Authentication.
 *
 * Per-agent keys derived from a master secret via HKDF provide isolation —
 * a compromised Reviewer key can't forge Deployer events.
 *
 * Key rotation: increment version in keyId (e.g., "kid_reviewer_v1" → "kid_reviewer_v2").
 * During rotation, verify against both current and previous key for a grace window.
 */

import { hkdfSync } from 'crypto';

export interface DerivedKey {
  key: Buffer;
  keyId: string;
}

/**
 * Derive a per-agent HMAC key from the master secret using HKDF.
 */
export function deriveAgentKey(
  masterSecret: string,
  agentId: string,
  version = 1,
): DerivedKey {
  const info = `yclaw-eventbus-${agentId}-v${version}`;
  const key = Buffer.from(hkdfSync('sha256', masterSecret, '', info, 32));
  return {
    key,
    keyId: `kid_${agentId}_v${version}`,
  };
}

/**
 * Key resolver — maps keyId to the corresponding secret.
 * Supports dual-key verification during rotation windows.
 */
export class KeyResolver {
  private keys = new Map<string, Buffer>();

  constructor(masterSecret: string, agentIds: string[], currentVersion = 1) {
    for (const agentId of agentIds) {
      // Current version
      const current = deriveAgentKey(masterSecret, agentId, currentVersion);
      this.keys.set(current.keyId, current.key);

      // Previous version (grace window for rotation)
      if (currentVersion > 1) {
        const previous = deriveAgentKey(masterSecret, agentId, currentVersion - 1);
        this.keys.set(previous.keyId, previous.key);
      }
    }
  }

  resolve(keyId: string): Buffer | undefined {
    return this.keys.get(keyId);
  }

  has(keyId: string): boolean {
    return this.keys.has(keyId);
  }
}
