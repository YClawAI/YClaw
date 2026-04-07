/**
 * Tests for .env variant classification in the risk classifier.
 *
 * Validates that ALL .env.* files (except .env.example) are classified
 * as CRITICAL. This is a security-critical behavior — environment files
 * may contain secrets and trigger hard gates + Architect review + canary deploy.
 *
 * Spec: docs/dev-dept-option-c-plan.md
 */

import { describe, it, expect } from 'vitest';
import { classifyFile, RiskTier } from '../src/deploy/risk-classifier.js';

describe('classifyFile — .env variant security classification', () => {
  // ─── CRITICAL: All .env variants with real secrets ────────────────────

  describe('.env variants → CRITICAL', () => {
    it('classifies .env as CRITICAL', () => {
      expect(classifyFile('.env')).toBe(RiskTier.CRITICAL);
    });

    it('classifies .env.local as CRITICAL', () => {
      expect(classifyFile('.env.local')).toBe(RiskTier.CRITICAL);
    });

    it('classifies .env.production as CRITICAL', () => {
      expect(classifyFile('.env.production')).toBe(RiskTier.CRITICAL);
    });

    it('classifies .env.staging as CRITICAL', () => {
      expect(classifyFile('.env.staging')).toBe(RiskTier.CRITICAL);
    });

    it('classifies .env.development as CRITICAL', () => {
      expect(classifyFile('.env.development')).toBe(RiskTier.CRITICAL);
    });

    it('classifies .env.test as CRITICAL', () => {
      expect(classifyFile('.env.test')).toBe(RiskTier.CRITICAL);
    });

    it('classifies .env.ci as CRITICAL', () => {
      expect(classifyFile('.env.ci')).toBe(RiskTier.CRITICAL);
    });

    it('classifies .env.docker as CRITICAL', () => {
      expect(classifyFile('.env.docker')).toBe(RiskTier.CRITICAL);
    });

    it('classifies .env.preview as CRITICAL', () => {
      expect(classifyFile('.env.preview')).toBe(RiskTier.CRITICAL);
    });

    it('classifies .env.backup as CRITICAL', () => {
      expect(classifyFile('.env.backup')).toBe(RiskTier.CRITICAL);
    });
  });

  // ─── MEDIUM: Only .env.example is safe ────────────────────────────────

  describe('.env.example → MEDIUM (safe)', () => {
    it('classifies .env.example as MEDIUM (not CRITICAL)', () => {
      // .env.example is excluded from CRITICAL via negative lookahead
      // and matched by MEDIUM patterns instead
      expect(classifyFile('.env.example')).toBe(RiskTier.MEDIUM);
    });
  });

  // ─── Edge cases ───────────────────────────────────────────────────────

  describe('.env edge cases', () => {
    it('classifies .env.example.bak as CRITICAL (not .env.example)', () => {
      // .env.example.bak is NOT .env.example — it should be CRITICAL
      // because the negative lookahead only excludes exact ".env.example"
      expect(classifyFile('.env.example.bak')).toBe(RiskTier.CRITICAL);
    });

    it('classifies nested .env files as HIGH (not root .env)', () => {
      // config/.env is not at root — the ^\.env patterns don't match
      // Falls through to HIGH (default for unmatched source files)
      expect(classifyFile('config/.env')).toBe(RiskTier.HIGH);
    });

    it('classifies nested .env.local as HIGH (not root)', () => {
      // src/.env.local is not at root
      expect(classifyFile('src/.env.local')).toBe(RiskTier.HIGH);
    });
  });
});
