/**
 * Tests for the file-path risk classifier.
 *
 * Validates that files are correctly classified into risk tiers (LOW, MEDIUM,
 * HIGH, CRITICAL) and that the overall deployment risk is the highest tier
 * among all changed files.
 *
 * Spec: docs/PROMPT-SYSTEM.md
 */

import { describe, it, expect } from 'vitest';
import {
  RiskTier,
  RISK_TIER_LABELS,
  classifyFile,
  classifyDeploymentRisk,
} from '../src/deploy/risk-classifier.js';

// ─── RiskTier Enum ──────────────────────────────────────────────────────────

describe('RiskTier enum', () => {
  it('has correct numeric ordering (LOW < MEDIUM < HIGH < CRITICAL)', () => {
    expect(RiskTier.LOW).toBeLessThan(RiskTier.MEDIUM);
    expect(RiskTier.MEDIUM).toBeLessThan(RiskTier.HIGH);
    expect(RiskTier.HIGH).toBeLessThan(RiskTier.CRITICAL);
  });

  it('has labels for all tiers', () => {
    expect(RISK_TIER_LABELS[RiskTier.LOW]).toBe('low');
    expect(RISK_TIER_LABELS[RiskTier.MEDIUM]).toBe('medium');
    expect(RISK_TIER_LABELS[RiskTier.HIGH]).toBe('high');
    expect(RISK_TIER_LABELS[RiskTier.CRITICAL]).toBe('critical');
  });
});

// ─── classifyFile: LOW tier ─────────────────────────────────────────────────

describe('classifyFile — LOW tier', () => {
  it('classifies markdown files as LOW', () => {
    expect(classifyFile('README.md')).toBe(RiskTier.LOW);
    expect(classifyFile('CHANGELOG.md')).toBe(RiskTier.LOW);
    expect(classifyFile('docs/guide.md')).toBe(RiskTier.LOW);
    expect(classifyFile('nested/deep/file.md')).toBe(RiskTier.LOW);
  });

  it('classifies markdown case-insensitively', () => {
    expect(classifyFile('README.MD')).toBe(RiskTier.LOW);
    expect(classifyFile('guide.Md')).toBe(RiskTier.LOW);
  });

  it('classifies docs/ directory files as LOW', () => {
    expect(classifyFile('docs/architecture.yaml')).toBe(RiskTier.LOW);
    expect(classifyFile('docs/api/endpoints.json')).toBe(RiskTier.LOW);
    expect(classifyFile('docs/PROMPT-SYSTEM.md')).toBe(RiskTier.LOW);
  });

  it('classifies prompts/ directory files as LOW', () => {
    expect(classifyFile('prompts/chain-of-command.md')).toBe(RiskTier.LOW);
    expect(classifyFile('prompts/brand-voice.md')).toBe(RiskTier.LOW);
    expect(classifyFile('prompts/new-prompt.yaml')).toBe(RiskTier.LOW);
  });

  it('classifies skills/ directory files as LOW', () => {
    expect(classifyFile('skills/shared/first-principles/SKILL.md')).toBe(RiskTier.LOW);
    expect(classifyFile('skills/sentinel/some-skill/SKILL.md')).toBe(RiskTier.LOW);
    expect(classifyFile('skills/shared/config.yaml')).toBe(RiskTier.LOW);
  });

  it('classifies LICENSE as LOW', () => {
    expect(classifyFile('LICENSE')).toBe(RiskTier.LOW);
  });

  it('classifies CODEOWNERS as LOW', () => {
    expect(classifyFile('CODEOWNERS')).toBe(RiskTier.LOW);
  });

  it('classifies .gitignore as LOW', () => {
    expect(classifyFile('.gitignore')).toBe(RiskTier.LOW);
  });

  it('classifies CLAUDE.md as LOW', () => {
    expect(classifyFile('CLAUDE.md')).toBe(RiskTier.LOW);
  });

  it('classifies .claude/ directory files as LOW', () => {
    expect(classifyFile('.claude/settings.json')).toBe(RiskTier.LOW);
    expect(classifyFile('.claude/config.yaml')).toBe(RiskTier.LOW);
  });
});

// ─── classifyFile: MEDIUM tier ──────────────────────────────────────────────

describe('classifyFile — MEDIUM tier', () => {
  it('classifies .env.example as MEDIUM', () => {
    expect(classifyFile('.env.example')).toBe(RiskTier.MEDIUM);
  });

  it('classifies departments/ YAML files as MEDIUM', () => {
    expect(classifyFile('departments/development/builder.yaml')).toBe(RiskTier.MEDIUM);
    expect(classifyFile('departments/executive/strategist.yaml')).toBe(RiskTier.MEDIUM);
    expect(classifyFile('departments/marketing/ember.yaml')).toBe(RiskTier.MEDIUM);
  });

  it('classifies .prettierrc variants as MEDIUM', () => {
    expect(classifyFile('.prettierrc')).toBe(RiskTier.MEDIUM);
    expect(classifyFile('.prettierrc.json')).toBe(RiskTier.MEDIUM);
    expect(classifyFile('.prettierrc.yaml')).toBe(RiskTier.MEDIUM);
    expect(classifyFile('.prettierrc.js')).toBe(RiskTier.MEDIUM);
  });

  it('classifies .eslintrc variants as MEDIUM', () => {
    expect(classifyFile('.eslintrc')).toBe(RiskTier.MEDIUM);
    expect(classifyFile('.eslintrc.json')).toBe(RiskTier.MEDIUM);
    expect(classifyFile('.eslintrc.js')).toBe(RiskTier.MEDIUM);
    expect(classifyFile('.eslintrc.cjs')).toBe(RiskTier.MEDIUM);
  });

  it('does not classify departments/ non-YAML files as MEDIUM', () => {
    // departments/README.md should be LOW (matched by .md pattern)
    expect(classifyFile('departments/README.md')).toBe(RiskTier.LOW);
  });
});

// ─── classifyFile: HIGH tier (default) ──────────────────────────────────────

describe('classifyFile — HIGH tier (default)', () => {
  it('classifies TypeScript source files as HIGH', () => {
    expect(classifyFile('packages/core/src/actions/deploy.ts')).toBe(RiskTier.HIGH);
    expect(classifyFile('src/index.ts')).toBe(RiskTier.HIGH);
    expect(classifyFile('packages/core/src/main.ts')).toBe(RiskTier.HIGH);
  });

  it('classifies JavaScript files as HIGH', () => {
    expect(classifyFile('lib/utils.js')).toBe(RiskTier.HIGH);
    expect(classifyFile('scripts/build.mjs')).toBe(RiskTier.HIGH);
  });

  it('classifies TSX/JSX files as HIGH', () => {
    expect(classifyFile('src/components/App.tsx')).toBe(RiskTier.HIGH);
    expect(classifyFile('src/components/Button.jsx')).toBe(RiskTier.HIGH);
  });

  it('classifies Dockerfile as HIGH', () => {
    expect(classifyFile('Dockerfile')).toBe(RiskTier.HIGH);
    expect(classifyFile('docker/Dockerfile.prod')).toBe(RiskTier.HIGH);
  });

  it('classifies CI workflow files as HIGH', () => {
    expect(classifyFile('.github/workflows/ci.yml')).toBe(RiskTier.HIGH);
    expect(classifyFile('.github/workflows/deploy.yaml')).toBe(RiskTier.HIGH);
  });

  it('classifies tsconfig.json as HIGH', () => {
    expect(classifyFile('tsconfig.json')).toBe(RiskTier.HIGH);
    expect(classifyFile('packages/core/tsconfig.json')).toBe(RiskTier.HIGH);
  });

  it('classifies package.json as HIGH', () => {
    expect(classifyFile('package.json')).toBe(RiskTier.HIGH);
    expect(classifyFile('packages/core/package.json')).toBe(RiskTier.HIGH);
  });

  it('classifies test files as HIGH', () => {
    expect(classifyFile('packages/core/tests/risk-classifier.test.ts')).toBe(RiskTier.HIGH);
    expect(classifyFile('src/__tests__/utils.test.ts')).toBe(RiskTier.HIGH);
  });

  it('classifies turbo.json as HIGH', () => {
    expect(classifyFile('turbo.json')).toBe(RiskTier.HIGH);
  });

  it('classifies .deploy-trigger as HIGH', () => {
    expect(classifyFile('.deploy-trigger')).toBe(RiskTier.HIGH);
  });

  it('classifies root-level YAML (non-config) as HIGH', () => {
    expect(classifyFile('config.yml')).toBe(RiskTier.HIGH);
    expect(classifyFile('settings.yaml')).toBe(RiskTier.HIGH);
  });

  it('classifies JSON files in source directories as HIGH', () => {
    expect(classifyFile('packages/core/config.json')).toBe(RiskTier.HIGH);
  });
});

// ─── classifyFile: CRITICAL tier ────────────────────────────────────────────

describe('classifyFile — CRITICAL tier', () => {
  it('classifies .pem files as CRITICAL', () => {
    expect(classifyFile('server.pem')).toBe(RiskTier.CRITICAL);
    expect(classifyFile('certs/ca.pem')).toBe(RiskTier.CRITICAL);
    expect(classifyFile('tls/cert.PEM')).toBe(RiskTier.CRITICAL);
  });

  it('classifies .key files as CRITICAL', () => {
    expect(classifyFile('private.key')).toBe(RiskTier.CRITICAL);
    expect(classifyFile('certs/server.key')).toBe(RiskTier.CRITICAL);
    expect(classifyFile('ssl/domain.KEY')).toBe(RiskTier.CRITICAL);
  });

  it('classifies .env (exact) as CRITICAL', () => {
    expect(classifyFile('.env')).toBe(RiskTier.CRITICAL);
  });

  it('does NOT classify .env.example as CRITICAL', () => {
    // .env.example should be MEDIUM, not CRITICAL
    expect(classifyFile('.env.example')).toBe(RiskTier.MEDIUM);
  });

  it('classifies .env.local and .env.production as CRITICAL', () => {
    // .env.* variants (except .env.example) are CRITICAL — they contain real secrets
    expect(classifyFile('.env.local')).toBe(RiskTier.CRITICAL);
    expect(classifyFile('.env.production')).toBe(RiskTier.CRITICAL);
  });

  it('classifies files with "secret" in the path as CRITICAL', () => {
    expect(classifyFile('config/secrets.yaml')).toBe(RiskTier.CRITICAL);
    expect(classifyFile('src/secret-manager.ts')).toBe(RiskTier.CRITICAL);
    expect(classifyFile('SECRET_KEY')).toBe(RiskTier.CRITICAL);
    expect(classifyFile('aws-secret-config.json')).toBe(RiskTier.CRITICAL);
  });

  it('classifies files with "credential" in the path as CRITICAL', () => {
    expect(classifyFile('credentials.json')).toBe(RiskTier.CRITICAL);
    expect(classifyFile('src/credential-store.ts')).toBe(RiskTier.CRITICAL);
    expect(classifyFile('CREDENTIALS')).toBe(RiskTier.CRITICAL);
  });

  it('classifies infrastructure/ directory files as CRITICAL', () => {
    expect(classifyFile('infrastructure/terraform/main.tf')).toBe(RiskTier.CRITICAL);
    expect(classifyFile('infrastructure/docker-compose.yml')).toBe(RiskTier.CRITICAL);
    expect(classifyFile('infrastructure/k8s/deployment.yaml')).toBe(RiskTier.CRITICAL);
  });

  it('CRITICAL takes precedence over LOW patterns', () => {
    // A markdown file with "secret" in the name → CRITICAL, not LOW
    expect(classifyFile('docs/secret-rotation.md')).toBe(RiskTier.CRITICAL);
    // A skills file with "credential" in the name → CRITICAL, not LOW
    expect(classifyFile('skills/shared/credential-handling/SKILL.md')).toBe(RiskTier.CRITICAL);
  });

  it('CRITICAL takes precedence over MEDIUM patterns', () => {
    // A departments YAML with "secret" in the name → CRITICAL
    expect(classifyFile('departments/secret-agent.yaml')).toBe(RiskTier.CRITICAL);
  });
});

// ─── classifyDeploymentRisk ─────────────────────────────────────────────────

describe('classifyDeploymentRisk', () => {
  it('returns HIGH for empty files list (safe default)', () => {
    expect(classifyDeploymentRisk([])).toBe(RiskTier.HIGH);
  });

  it('returns LOW when all files are LOW', () => {
    expect(
      classifyDeploymentRisk([
        'README.md',
        'docs/guide.md',
        'prompts/chain-of-command.md',
        'skills/shared/first-principles/SKILL.md',
        'LICENSE',
        'CODEOWNERS',
        '.gitignore',
        'CLAUDE.md',
      ]),
    ).toBe(RiskTier.LOW);
  });

  it('returns MEDIUM when highest file is MEDIUM', () => {
    expect(
      classifyDeploymentRisk([
        'README.md',
        'departments/development/builder.yaml',
      ]),
    ).toBe(RiskTier.MEDIUM);
  });

  it('returns MEDIUM for config-only changes', () => {
    expect(
      classifyDeploymentRisk([
        '.env.example',
        '.prettierrc.json',
        '.eslintrc.js',
      ]),
    ).toBe(RiskTier.MEDIUM);
  });

  it('returns HIGH when any source file is present', () => {
    expect(
      classifyDeploymentRisk([
        'README.md',
        'packages/core/src/actions/deploy.ts',
      ]),
    ).toBe(RiskTier.HIGH);
  });

  it('returns HIGH for code-only changes', () => {
    expect(
      classifyDeploymentRisk([
        'packages/core/src/index.ts',
        'packages/core/src/main.ts',
      ]),
    ).toBe(RiskTier.HIGH);
  });

  it('returns HIGH for CI workflow changes', () => {
    expect(
      classifyDeploymentRisk(['.github/workflows/ci.yml']),
    ).toBe(RiskTier.HIGH);
  });

  it('returns CRITICAL when any CRITICAL file is present', () => {
    expect(
      classifyDeploymentRisk([
        'README.md',
        'packages/core/src/index.ts',
        '.env',
      ]),
    ).toBe(RiskTier.CRITICAL);
  });

  it('returns CRITICAL for infrastructure changes', () => {
    expect(
      classifyDeploymentRisk([
        'infrastructure/terraform/main.tf',
        'README.md',
      ]),
    ).toBe(RiskTier.CRITICAL);
  });

  it('returns CRITICAL for secret-related files', () => {
    expect(
      classifyDeploymentRisk(['config/secrets.yaml']),
    ).toBe(RiskTier.CRITICAL);
  });

  it('returns CRITICAL for credential files', () => {
    expect(
      classifyDeploymentRisk(['credentials.json']),
    ).toBe(RiskTier.CRITICAL);
  });

  it('returns CRITICAL for certificate files', () => {
    expect(
      classifyDeploymentRisk(['certs/server.pem', 'certs/server.key']),
    ).toBe(RiskTier.CRITICAL);
  });

  it('short-circuits on CRITICAL (does not check remaining files)', () => {
    // Even with 1000 files, if the first is CRITICAL, result is CRITICAL
    const files = ['.env', ...Array.from({ length: 999 }, (_, i) => `file${i}.md`)];
    expect(classifyDeploymentRisk(files)).toBe(RiskTier.CRITICAL);
  });

  it('handles single LOW file', () => {
    expect(classifyDeploymentRisk(['README.md'])).toBe(RiskTier.LOW);
  });

  it('handles single HIGH file', () => {
    expect(classifyDeploymentRisk(['src/index.ts'])).toBe(RiskTier.HIGH);
  });

  it('handles single CRITICAL file', () => {
    expect(classifyDeploymentRisk(['.env'])).toBe(RiskTier.CRITICAL);
  });

  it('handles single MEDIUM file', () => {
    expect(classifyDeploymentRisk(['.env.example'])).toBe(RiskTier.MEDIUM);
  });

  it('correctly escalates from LOW → MEDIUM → HIGH → CRITICAL', () => {
    // LOW only
    expect(classifyDeploymentRisk(['README.md'])).toBe(RiskTier.LOW);

    // LOW + MEDIUM → MEDIUM
    expect(
      classifyDeploymentRisk(['README.md', '.env.example']),
    ).toBe(RiskTier.MEDIUM);

    // LOW + MEDIUM + HIGH → HIGH
    expect(
      classifyDeploymentRisk(['README.md', '.env.example', 'src/index.ts']),
    ).toBe(RiskTier.HIGH);

    // LOW + MEDIUM + HIGH + CRITICAL → CRITICAL
    expect(
      classifyDeploymentRisk([
        'README.md',
        '.env.example',
        'src/index.ts',
        '.env',
      ]),
    ).toBe(RiskTier.CRITICAL);
  });
});

// ─── Edge Cases ─────────────────────────────────────────────────────────────

describe('classifyFile — edge cases', () => {
  it('does not match partial directory names', () => {
    // "documentation/" is not "docs/" — should be HIGH
    expect(classifyFile('documentation/guide.txt')).toBe(RiskTier.HIGH);
  });

  it('does not match "docs" as a filename (only as directory)', () => {
    // "docs" without trailing slash is not a directory match
    // But "docs" alone doesn't match /^docs\// — it's just a filename
    // It also doesn't match any other pattern → HIGH
    expect(classifyFile('docs')).toBe(RiskTier.HIGH);
  });

  it('handles deeply nested paths', () => {
    expect(
      classifyFile('packages/core/src/deeply/nested/module.ts'),
    ).toBe(RiskTier.HIGH);
    expect(
      classifyFile('docs/api/v2/internal/endpoints.yaml'),
    ).toBe(RiskTier.LOW);
  });

  it('handles files with multiple extensions', () => {
    expect(classifyFile('config.test.ts')).toBe(RiskTier.HIGH);
    expect(classifyFile('README.backup.md')).toBe(RiskTier.LOW);
  });

  it('handles .env variants correctly', () => {
    expect(classifyFile('.env')).toBe(RiskTier.CRITICAL);
    expect(classifyFile('.env.example')).toBe(RiskTier.MEDIUM);
    expect(classifyFile('.env.local')).toBe(RiskTier.CRITICAL);
    expect(classifyFile('.env.production')).toBe(RiskTier.CRITICAL);
    expect(classifyFile('.env.test')).toBe(RiskTier.CRITICAL);
  });

  it('handles paths with special characters', () => {
    expect(classifyFile('docs/my-guide.md')).toBe(RiskTier.LOW);
    expect(classifyFile('docs/my_guide.md')).toBe(RiskTier.LOW);
    expect(classifyFile('src/my-module.ts')).toBe(RiskTier.HIGH);
  });

  it('does not false-positive on "secret" in safe directories', () => {
    // "secret" in the path triggers CRITICAL even in docs/
    // This is intentional — CRITICAL patterns are checked first
    expect(classifyFile('docs/secret-rotation.md')).toBe(RiskTier.CRITICAL);
  });

  it('handles .claude/ directory correctly', () => {
    expect(classifyFile('.claude/settings.json')).toBe(RiskTier.LOW);
    expect(classifyFile('.claude/config')).toBe(RiskTier.LOW);
  });

  it('handles CLAUDE.md correctly', () => {
    expect(classifyFile('CLAUDE.md')).toBe(RiskTier.LOW);
    // But claude.md (lowercase) is still LOW because .md matches
    expect(classifyFile('claude.md')).toBe(RiskTier.LOW);
  });
});
