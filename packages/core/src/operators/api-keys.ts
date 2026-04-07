import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import argon2 from 'argon2';

// ─── API Key Utilities ─────────────────────────────────────────────────────────

const API_KEY_PREFIX = 'gzop_live_';
const INVITE_TOKEN_PREFIX = 'gzinv_';

/** Generate a new operator API key. Returns the raw key (shown once), prefix, and hash. */
export async function generateApiKey(): Promise<{ key: string; prefix: string; hash: string }> {
  const random = randomBytes(32).toString('base64url');
  const key = `${API_KEY_PREFIX}${random}`;
  const prefix = random.slice(0, 8);
  const hash = await hashApiKey(key);
  return { key, prefix, hash };
}

/** Hash an API key using argon2id. */
export async function hashApiKey(key: string): Promise<string> {
  return argon2.hash(key, { type: argon2.argon2id });
}

/** Verify an API key against a stored argon2id hash. */
export async function verifyApiKey(key: string, storedHash: string): Promise<boolean> {
  try {
    return await argon2.verify(storedHash, key);
  } catch {
    return false;
  }
}

/** Extract the prefix from a raw API key. Returns null if format is invalid. */
export function extractKeyPrefix(key: string): string | null {
  if (!key.startsWith(API_KEY_PREFIX)) return null;
  const rest = key.slice(API_KEY_PREFIX.length);
  if (rest.length < 8) return null;
  return rest.slice(0, 8);
}

/** Generate an invitation token. Returns the raw token and its SHA-256 hash (for lookup). */
export function generateInviteToken(): { token: string; hash: string } {
  const random = randomBytes(48).toString('base64url');
  const token = `${INVITE_TOKEN_PREFIX}${random}`;
  // Invite tokens use SHA-256 for lookup (they're single-use, high-entropy, and need fast lookup)
  const hash = createHash('sha256').update(token).digest('hex');
  return { token, hash };
}

/** SHA-256 hash for invite token lookup (NOT for API key storage). */
export function hashInviteToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
