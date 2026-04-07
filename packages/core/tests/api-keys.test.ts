import { describe, it, expect } from 'vitest';
import {
  generateApiKey,
  hashApiKey,
  verifyApiKey,
  extractKeyPrefix,
  generateInviteToken,
  hashInviteToken,
} from '../src/operators/api-keys.js';

describe('API Key Utilities', () => {
  describe('generateApiKey', () => {
    it('generates a key with the correct prefix format', async () => {
      const { key, prefix, hash } = await generateApiKey();
      expect(key).toMatch(/^gzop_live_/);
      expect(prefix).toHaveLength(8);
      // argon2id hash starts with $argon2id$
      expect(hash).toMatch(/^\$argon2id\$/);
    });

    it('generates unique keys on each call', async () => {
      const a = await generateApiKey();
      const b = await generateApiKey();
      expect(a.key).not.toBe(b.key);
      expect(a.prefix).not.toBe(b.prefix);
      expect(a.hash).not.toBe(b.hash);
    });
  });

  describe('hashApiKey', () => {
    it('returns argon2id hashes', async () => {
      const hash = await hashApiKey('gzop_live_test12345678');
      expect(hash).toMatch(/^\$argon2id\$/);
    });

    it('returns different hashes for the same input (salted)', async () => {
      const key = 'gzop_live_test12345678';
      const hash1 = await hashApiKey(key);
      const hash2 = await hashApiKey(key);
      // argon2id uses random salt, so same input → different hash
      expect(hash1).not.toBe(hash2);
    });
  });

  describe('verifyApiKey', () => {
    it('returns true for a valid key/hash pair', async () => {
      const { key, hash } = await generateApiKey();
      expect(await verifyApiKey(key, hash)).toBe(true);
    });

    it('returns false for a wrong key', async () => {
      const { hash } = await generateApiKey();
      expect(await verifyApiKey('gzop_live_wrong', hash)).toBe(false);
    });

    it('returns false for a wrong hash', async () => {
      const { key } = await generateApiKey();
      expect(await verifyApiKey(key, '$argon2id$v=19$m=65536,t=3,p=4$fakesalt$fakehash')).toBe(false);
    });

    it('returns false for malformed hash', async () => {
      const { key } = await generateApiKey();
      expect(await verifyApiKey(key, 'not-a-hash')).toBe(false);
    });
  });

  describe('extractKeyPrefix', () => {
    it('extracts prefix from a valid key', async () => {
      const { key, prefix } = await generateApiKey();
      expect(extractKeyPrefix(key)).toBe(prefix);
    });

    it('returns null for invalid key format', () => {
      expect(extractKeyPrefix('invalid_key')).toBeNull();
      expect(extractKeyPrefix('gzop_live_')).toBeNull(); // too short after prefix
      expect(extractKeyPrefix('')).toBeNull();
    });

    it('returns null for keys with wrong prefix', () => {
      expect(extractKeyPrefix('gzop_test_abcdefgh12345')).toBeNull();
    });
  });

  describe('generateInviteToken', () => {
    it('generates a token with the correct prefix', () => {
      const { token, hash } = generateInviteToken();
      expect(token).toMatch(/^gzinv_/);
      expect(hash).toHaveLength(64); // SHA-256 hex for fast lookup
    });

    it('generates unique tokens', () => {
      const a = generateInviteToken();
      const b = generateInviteToken();
      expect(a.token).not.toBe(b.token);
    });

    it('token hash can be verified via hashInviteToken', () => {
      const { token, hash } = generateInviteToken();
      expect(hashInviteToken(token)).toBe(hash);
    });
  });
});
