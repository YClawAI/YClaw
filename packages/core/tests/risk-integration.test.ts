/**
 * Tests for the risk-based deploy governance integration.
 *
 * Validates that the assessDeploymentRisk function correctly maps
 * file-path risk tiers to assessment behavior (skip, notify, vote, human).
 *
 * Spec: docs/dev-dept-option-c-plan.md (Layer 2 + Layer 3)
 */

import { describe, it, expect } from 'vitest';
import { assessDeploymentRisk } from '../src/deploy/risk-integration.js';

describe('assessDeploymentRisk', () => {
  // ─── LOW tier: skip assessment, auto-approve ───────────────────────────────

  describe('LOW tier — docs-only fast-track', () => {
    it('auto-approves markdown-only changes', () => {
      const result = assessDeploymentRisk(['README.md', 'docs/guide.md']);
      expect(result.skipAssessment).toBe(true);
      expect(result.requireHuman).toBe(false);
      expect(result.notify).toBe(false);
      expect(result.approved).toBe(true);
      expect(result.riskTier).toBe('low');
      expect(result.repoRiskTier).toBe('auto');
      expect(result.reason).toContain('Docs-only fast-track');
    });

    it('auto-approves prompts/ changes', () => {
      const result = assessDeploymentRisk([
        'prompts/chain-of-command.md',
        'prompts/brand-voice.md',
      ]);
      expect(result.skipAssessment).toBe(true);
      expect(result.approved).toBe(true);
      expect(result.riskTier).toBe('low');
    });

    it('auto-approves skills/ changes', () => {
      const result = assessDeploymentRisk([
        'skills/shared/first-principles/SKILL.md',
      ]);
      expect(result.skipAssessment).toBe(true);
      expect(result.approved).toBe(true);
      expect(result.riskTier).toBe('low');
    });

    it('auto-approves LICENSE, CODEOWNERS, .gitignore', () => {
      const result = assessDeploymentRisk([
        'LICENSE',
        'CODEOWNERS',
        '.gitignore',
      ]);
      expect(result.skipAssessment).toBe(true);
      expect(result.approved).toBe(true);
      expect(result.riskTier).toBe('low');
    });

    it('auto-approves CLAUDE.md and .claude/ changes', () => {
      const result = assessDeploymentRisk([
        'CLAUDE.md',
        '.claude/settings.json',
      ]);
      expect(result.skipAssessment).toBe(true);
      expect(result.approved).toBe(true);
      expect(result.riskTier).toBe('low');
    });
  });

  // ─── MEDIUM tier: skip assessment, auto-approve with notification ──────────

  describe('MEDIUM tier — config auto-approve with notification', () => {
    it('auto-approves .env.example with notification', () => {
      const result = assessDeploymentRisk(['.env.example']);
      expect(result.skipAssessment).toBe(true);
      expect(result.requireHuman).toBe(false);
      expect(result.notify).toBe(true);
      expect(result.approved).toBe(true);
      expect(result.riskTier).toBe('medium');
      expect(result.repoRiskTier).toBe('auto');
      expect(result.reason).toContain('Config-only auto-approve');
    });

    it('auto-approves departments/ YAML with notification', () => {
      const result = assessDeploymentRisk([
        'departments/development/builder.yaml',
      ]);
      expect(result.skipAssessment).toBe(true);
      expect(result.notify).toBe(true);
      expect(result.approved).toBe(true);
      expect(result.riskTier).toBe('medium');
    });

    it('auto-approves linter config with notification', () => {
      const result = assessDeploymentRisk([
        '.prettierrc.json',
        '.eslintrc.js',
      ]);
      expect(result.skipAssessment).toBe(true);
      expect(result.notify).toBe(true);
      expect(result.approved).toBe(true);
      expect(result.riskTier).toBe('medium');
    });

    it('escalates to MEDIUM when LOW + MEDIUM files mixed', () => {
      const result = assessDeploymentRisk([
        'README.md',
        'departments/development/builder.yaml',
      ]);
      expect(result.skipAssessment).toBe(true);
      expect(result.notify).toBe(true);
      expect(result.riskTier).toBe('medium');
    });
  });

  // ─── HIGH tier: full assessment vote ───────────────────────────────────────

  describe('HIGH tier — full assessment vote', () => {
    it('requires assessment for source code changes', () => {
      const result = assessDeploymentRisk([
        'packages/core/src/actions/deploy.ts',
      ]);
      expect(result.skipAssessment).toBe(false);
      expect(result.requireHuman).toBe(false);
      expect(result.notify).toBe(false);
      expect(result.approved).toBe(false);
      expect(result.riskTier).toBe('high');
      expect(result.repoRiskTier).toBe('guarded');
      expect(result.reason).toContain('full assessment vote');
    });

    it('requires assessment for Dockerfile changes', () => {
      const result = assessDeploymentRisk(['Dockerfile']);
      expect(result.skipAssessment).toBe(false);
      expect(result.riskTier).toBe('high');
      expect(result.repoRiskTier).toBe('guarded');
    });

    it('requires assessment for CI workflow changes', () => {
      const result = assessDeploymentRisk([
        '.github/workflows/ci.yml',
      ]);
      expect(result.skipAssessment).toBe(false);
      expect(result.riskTier).toBe('high');
    });

    it('escalates to HIGH when docs + code mixed', () => {
      const result = assessDeploymentRisk([
        'README.md',
        'packages/core/src/index.ts',
      ]);
      expect(result.skipAssessment).toBe(false);
      expect(result.riskTier).toBe('high');
    });

    it('requires assessment for empty file list (safe default)', () => {
      const result = assessDeploymentRisk([]);
      expect(result.skipAssessment).toBe(false);
      expect(result.riskTier).toBe('high');
      expect(result.repoRiskTier).toBe('guarded');
    });
  });

  // ─── CRITICAL tier: hard gates + Architect review ────────────────────────

  describe('CRITICAL tier — hard gates + Architect review', () => {
    it('requires assessment (no human) for .env changes', () => {
      const result = assessDeploymentRisk(['.env']);
      expect(result.skipAssessment).toBe(false);
      expect(result.requireHuman).toBe(false);
      expect(result.notify).toBe(false);
      expect(result.approved).toBe(false);
      expect(result.riskTier).toBe('critical');
      expect(result.repoRiskTier).toBe('critical');
      expect(result.reason).toContain('Architect review');
    });

    it('requires assessment (no human) for .env.production', () => {
      const result = assessDeploymentRisk(['.env.production']);
      expect(result.skipAssessment).toBe(false);
      expect(result.requireHuman).toBe(false);
      expect(result.riskTier).toBe('critical');
      expect(result.repoRiskTier).toBe('critical');
    });

    it('requires assessment (no human) for .env.local', () => {
      const result = assessDeploymentRisk(['.env.local']);
      expect(result.skipAssessment).toBe(false);
      expect(result.requireHuman).toBe(false);
      expect(result.riskTier).toBe('critical');
    });

    it('requires assessment (no human) for .env.staging', () => {
      const result = assessDeploymentRisk(['.env.staging']);
      expect(result.skipAssessment).toBe(false);
      expect(result.requireHuman).toBe(false);
      expect(result.riskTier).toBe('critical');
    });

    it('requires assessment (no human) for .env.development', () => {
      const result = assessDeploymentRisk(['.env.development']);
      expect(result.skipAssessment).toBe(false);
      expect(result.requireHuman).toBe(false);
      expect(result.riskTier).toBe('critical');
    });

    it('requires assessment (no human) for infrastructure changes', () => {
      const result = assessDeploymentRisk([
        'infrastructure/terraform/main.tf',
      ]);
      expect(result.skipAssessment).toBe(false);
      expect(result.requireHuman).toBe(false);
      expect(result.riskTier).toBe('critical');
    });

    it('requires assessment (no human) for secret-related files', () => {
      const result = assessDeploymentRisk(['config/secrets.yaml']);
      expect(result.skipAssessment).toBe(false);
      expect(result.requireHuman).toBe(false);
      expect(result.riskTier).toBe('critical');
    });

    it('requires assessment (no human) for certificate files', () => {
      const result = assessDeploymentRisk(['certs/server.pem']);
      expect(result.skipAssessment).toBe(false);
      expect(result.requireHuman).toBe(false);
      expect(result.riskTier).toBe('critical');
    });

    it('escalates to CRITICAL when any CRITICAL file present', () => {
      const result = assessDeploymentRisk([
        'README.md',
        'packages/core/src/index.ts',
        '.env',
      ]);
      expect(result.skipAssessment).toBe(false);
      expect(result.requireHuman).toBe(false);
      expect(result.riskTier).toBe('critical');
    });
  });

  // ─── Escalation behavior ──────────────────────────────────────────────

  describe('escalation — highest tier wins', () => {
    it('LOW + MEDIUM → MEDIUM', () => {
      const result = assessDeploymentRisk([
        'README.md',
        '.env.example',
      ]);
      expect(result.riskTier).toBe('medium');
      expect(result.skipAssessment).toBe(true);
      expect(result.notify).toBe(true);
    });

    it('LOW + HIGH → HIGH', () => {
      const result = assessDeploymentRisk([
        'README.md',
        'src/index.ts',
      ]);
      expect(result.riskTier).toBe('high');
      expect(result.skipAssessment).toBe(false);
    });

    it('MEDIUM + HIGH → HIGH', () => {
      const result = assessDeploymentRisk([
        '.env.example',
        'src/index.ts',
      ]);
      expect(result.riskTier).toBe('high');
      expect(result.skipAssessment).toBe(false);
    });

    it('HIGH + CRITICAL → CRITICAL', () => {
      const result = assessDeploymentRisk([
        'src/index.ts',
        '.env',
      ]);
      expect(result.riskTier).toBe('critical');
      expect(result.requireHuman).toBe(false);
    });

    it('LOW + MEDIUM + HIGH + CRITICAL → CRITICAL', () => {
      const result = assessDeploymentRisk([
        'README.md',
        '.env.example',
        'src/index.ts',
        '.env',
      ]);
      expect(result.riskTier).toBe('critical');
      expect(result.requireHuman).toBe(false);
    });
  });

  // ─── .env variant classification ──────────────────────────────────────

  describe('.env variant classification', () => {
    it('.env.example stays MEDIUM (no secrets)', () => {
      const result = assessDeploymentRisk(['.env.example']);
      expect(result.riskTier).toBe('medium');
    });

    it('.env.production is CRITICAL (contains secrets)', () => {
      const result = assessDeploymentRisk(['.env.production']);
      expect(result.riskTier).toBe('critical');
      expect(result.requireHuman).toBe(false);
    });

    it('.env.local is CRITICAL (contains secrets)', () => {
      const result = assessDeploymentRisk(['.env.local']);
      expect(result.riskTier).toBe('critical');
    });

    it('.env.staging is CRITICAL (contains secrets)', () => {
      const result = assessDeploymentRisk(['.env.staging']);
      expect(result.riskTier).toBe('critical');
    });

    it('.env.development is CRITICAL (contains secrets)', () => {
      const result = assessDeploymentRisk(['.env.development']);
      expect(result.riskTier).toBe('critical');
    });

    it('.env.test is CRITICAL (.env.* variants except .env.example)', () => {
      const result = assessDeploymentRisk(['.env.test']);
      expect(result.riskTier).toBe('critical');
    });
  });
});
