import { describe, it, expect } from 'vitest';
import { hashContent, createProvenance } from '../src/onboarding/provenance.js';

describe('provenance', () => {
  describe('hashContent', () => {
    it('produces consistent SHA-256 hash for same input', () => {
      const hash1 = hashContent('hello world');
      const hash2 = hashContent('hello world');
      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(64); // SHA-256 hex = 64 chars
    });

    it('produces different hash for different input', () => {
      const hash1 = hashContent('hello');
      const hash2 = hashContent('world');
      expect(hash1).not.toBe(hash2);
    });

    it('works with Buffer input', () => {
      const hash1 = hashContent(Buffer.from('test'));
      const hash2 = hashContent('test');
      expect(hash1).toBe(hash2);
    });

    it('produces known SHA-256 for empty string', () => {
      const hash = hashContent('');
      // SHA-256 of empty string is well-known
      expect(hash).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    });
  });

  describe('createProvenance', () => {
    it('creates complete provenance record', () => {
      const prov = createProvenance('file', 'test.pdf', 'file content', 'job-123');
      expect(prov.sourceType).toBe('file');
      expect(prov.sourceUri).toBe('test.pdf');
      expect(prov.contentHash).toHaveLength(64);
      expect(prov.importJobId).toBe('job-123');
      expect(prov.importedAt).toBeInstanceOf(Date);
      expect(prov.sizeBytes).toBe(Buffer.byteLength('file content', 'utf8'));
    });

    it('generates job ID when not provided', () => {
      const prov = createProvenance('url', 'https://example.com', 'content');
      expect(prov.importJobId).toBeTruthy();
      expect(prov.importJobId).toHaveLength(36); // UUID v4
    });

    it('calculates correct size for Buffer', () => {
      const buf = Buffer.alloc(1024, 'x');
      const prov = createProvenance('file', 'data.bin', buf);
      expect(prov.sizeBytes).toBe(1024);
    });

    it('calculates correct size for multi-byte strings', () => {
      const utf8 = '日本語'; // 3 chars, 9 bytes in UTF-8
      const prov = createProvenance('text', 'input', utf8);
      expect(prov.sizeBytes).toBe(9);
    });
  });
});
