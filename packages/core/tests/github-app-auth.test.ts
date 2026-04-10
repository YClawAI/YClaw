import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// We need to dynamically import the module so env vars are read fresh
let appAuth: typeof import('../src/actions/github/app-auth.js');

async function loadModule() {
  // Reset module cache to pick up new env vars
  vi.resetModules();
  appAuth = await import('../src/actions/github/app-auth.js');
  appAuth._resetForTesting();
}

// ─── Test Helpers ───────────────────────────────────────────────────────────

// RSA-2048 test key (NOT a real key — generated for testing only)
const TEST_PEM = `-----BEGIN RSA PRIVATE KEY-----
MIIEpAIBAAKCAQEA0Z3VS5JJcds3xfn/ygWzF8PbnGy0AHB7MhgHcTz6sE2I2yPB
aFDrBz95mG5FXhqFkHoIIqkOK6p6TjFCi+QOcwOtN1+5xZGvMPiGHJsTbqAEbDO
yLPE2MBbNIkxOD/+lNOZjdZ3FqSOjfFNn0UuYFCPqxkOCE/kq+sPh3QqtXmhNJN
X1Cz5kfN3XPVHkBwKF0BYDRGq7gfWMSaMGqwO6Qe/wJpsBi+cGFLYH7mv7v6dHA
Q3FeGUJnBFy1gQBMPsCbNLwJDBzqXpkN0MsPJnVLoX+Z5Rs4d5De5dZ8bGbJOZEN
Slc7b1MOCajSBFgGVqWxHist2Sm6TrCfVPHaPwIDAQABAoIBAC5RgZ+hBx7xHNaM
pPgwGMZV5NX1GOZ0qnFTQL4aFMXi1t+RsqMvPE8VpaRUAh3TqjQj8DmstainGiZO
Wewi5sFSMVYO4YwqLME3cTXUaNNPE5Kg3VFj2PCGA9mJpM2j3CTQZV4U8AQFHMN5
aHBi/hLMQ/sH35GjSaJZlGcfVBPQbqhX6FEJBBr+17p5koSVOj9F4bAt1VkYjK7g
wGjf3nrMVU5qJdYreAb+7bM8+x4DlhdTNWGqwNIJi1B2D1uD7j9pjr/rXKqWD1j
5VBKHp3MyxJT4Cq/r3V5gqT5CjCV5bblT5l+3S3FLQV2r7K4O1Ho0O4BF2WGjjH
7+JV7oECgYEA7y+oLzTUJzYl2cq+1K5rjsEXXYUjjBD/jO0F21SVpxAofsOrqvDa
lM1kDq11u9UtVB6LjVH3JOJXrjGJlGaaCvr2Y8ddAk9tWDB5JDjCE7tpkaPHlhqB
VV6fhMGLS+4OO2UrJaEn7/I5xHKCYa8W3XNtUQ9fCbhsFX1shL71PwkCgYEA4HpW
XxH40xwGGpI7fs59n7LnNqLfTzNT7i3pMiWCDlt6qZLp9NUUbFOFIElGKOLN8HJv
RQzKBSiVgnRo9bE/uyRuJIgOxU2h/w+XEMlBmvLk0G+kO2yNjn5s8LOlVca5qEP
LqHM3k/JE8dc0Z5lNCOimVc0SCb5gwHJaRPNj88CgYBNJiLs3lGayxLWXeJzEXoq
Tn0LMbN0R3nJ0IvdHDRH3TS2YFHKiJrT2FRx2bDzd+dB2S3EZHojQKVcYdmPS2w4
SXKZ/h3IPCd5gFAMbKq+bCmpDsjIz0A/YDkCQ0mKaSg2wiJHBLH+jwPQF1vBhPhG
w/j8ZXGKSBMjT0p7PThGUQKBgQC++/e3dU2XCPUY0wPmmjAQy1lOEkxFv/cjxBjW
ZCV2vLDcFPeBhO1BQMF0RjWC3Lz6UC8DKOD+Ij2r7c0x1FHHd1z5K9h9dMEsEr+
NuaQXbBb1ERW+bh3h+5nEN4ypVOb7GcEqHo/4vi0eL3fTR+z+diVqoXh+l5gSsM7
bJR07QKBgQCdW0FP3qGHPPsnlriCiRvthj3CMMq0bMS0xjiwI0FkgSCL8MsJU7t4
K5vslD/3SMV/A1zIVMZ2h9GnfpBYKVQWPaL7MDQO4M6qPgBNFP/ZK9kldBm4R3v
C5lkTi0sPlFQ8RJBkk3CUFpT2EMmdAj/AWtxEAv9kE3s6cT3SFLQYQ==
-----END RSA PRIVATE KEY-----`;

const TEST_PEM_BASE64 = Buffer.from(TEST_PEM).toString('base64');

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('GitHub App Auth', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Clean environment
    delete process.env.GITHUB_APP_ID;
    delete process.env.GITHUB_APP_PRIVATE_KEY;
    delete process.env.GITHUB_APP_INSTALLATION_ID;
    delete process.env.GITHUB_TOKEN;
  });

  afterEach(() => {
    // Restore environment
    process.env = { ...originalEnv };
  });

  describe('Auth Method Detection', () => {
    it('detects App auth when all three env vars are set', async () => {
      process.env.GITHUB_APP_ID = '12345';
      process.env.GITHUB_APP_PRIVATE_KEY = TEST_PEM;
      process.env.GITHUB_APP_INSTALLATION_ID = '67890';
      await loadModule();

      expect(appAuth.getAuthMethod()).toBe('app');
    });

    it('falls back to PAT when GITHUB_TOKEN is set', async () => {
      process.env.GITHUB_TOKEN = 'ghp_test123';
      await loadModule();

      expect(appAuth.getAuthMethod()).toBe('pat');
    });

    it('returns none when no credentials configured', async () => {
      await loadModule();

      expect(appAuth.getAuthMethod()).toBe('none');
    });

    it('prefers App auth over PAT when both are set', async () => {
      process.env.GITHUB_APP_ID = '12345';
      process.env.GITHUB_APP_PRIVATE_KEY = TEST_PEM;
      process.env.GITHUB_APP_INSTALLATION_ID = '67890';
      process.env.GITHUB_TOKEN = 'ghp_test123';
      await loadModule();

      expect(appAuth.getAuthMethod()).toBe('app');
    });

    it('requires all three App env vars', async () => {
      process.env.GITHUB_APP_ID = '12345';
      process.env.GITHUB_APP_PRIVATE_KEY = TEST_PEM;
      // Missing GITHUB_APP_INSTALLATION_ID
      await loadModule();

      expect(appAuth.getAuthMethod()).toBe('none');
    });
  });

  describe('isGitHubAuthAvailable', () => {
    it('returns true when PAT is set', async () => {
      process.env.GITHUB_TOKEN = 'ghp_test';
      await loadModule();

      expect(appAuth.isGitHubAuthAvailable()).toBe(true);
    });

    it('returns false when nothing is set', async () => {
      await loadModule();

      expect(appAuth.isGitHubAuthAvailable()).toBe(false);
    });
  });

  describe('getGitHubToken — PAT fallback', () => {
    it('returns the PAT directly', async () => {
      process.env.GITHUB_TOKEN = 'ghp_testtoken123';
      await loadModule();

      const token = await appAuth.getGitHubToken();
      expect(token).toBe('ghp_testtoken123');
    });
  });

  describe('getGitHubToken — no auth', () => {
    it('throws when no credentials configured', async () => {
      await loadModule();

      await expect(appAuth.getGitHubToken()).rejects.toThrow(
        /No GitHub credentials configured/,
      );
    });
  });

  describe('Private Key Resolution', () => {
    it('handles raw PEM string', async () => {
      await loadModule();

      const resolved = appAuth._resolvePrivateKey(TEST_PEM);
      expect(resolved).toContain('-----BEGIN RSA PRIVATE KEY-----');
    });

    it('handles base64-encoded PEM', async () => {
      await loadModule();

      const resolved = appAuth._resolvePrivateKey(TEST_PEM_BASE64);
      expect(resolved).toContain('-----BEGIN RSA PRIVATE KEY-----');
    });

    it('handles file path', async () => {
      const tmpDir = mkdtempSync(join(tmpdir(), 'gh-auth-test-'));
      const keyPath = join(tmpDir, 'test.pem');
      writeFileSync(keyPath, TEST_PEM);

      try {
        await loadModule();
        const resolved = appAuth._resolvePrivateKey(keyPath);
        expect(resolved).toContain('-----BEGIN RSA PRIVATE KEY-----');
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it('throws on invalid input', async () => {
      await loadModule();

      expect(() => appAuth._resolvePrivateKey('not-a-key-at-all')).toThrow(
        /must be a PEM string, base64-encoded PEM, or file path/,
      );
    });

    it('throws when file does not contain PEM', async () => {
      const tmpDir = mkdtempSync(join(tmpdir(), 'gh-auth-test-'));
      const keyPath = join(tmpDir, 'bad.pem');
      writeFileSync(keyPath, 'this is not a PEM file');

      try {
        await loadModule();
        expect(() => appAuth._resolvePrivateKey(keyPath)).toThrow(
          /does not contain a valid PEM key/,
        );
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });

  describe('initGitHubAuth', () => {
    it('returns the detected auth method', async () => {
      process.env.GITHUB_TOKEN = 'ghp_test';
      await loadModule();

      const method = appAuth.initGitHubAuth();
      expect(method).toBe('pat');
    });
  });
});

describe('GitHub App Manifest', () => {
  it('generates a valid manifest', async () => {
    const { generateManifest } = await import(
      '../src/onboarding/github-app-manifest.js'
    );

    const manifest = generateManifest('https://agents.yclaw.ai');

    expect(manifest.url).toBe('https://yclaw.ai');
    expect((manifest.hook_attributes as { url: string }).url).toBe(
      'https://agents.yclaw.ai/github/webhook',
    );
    expect(manifest.redirect_url).toBe(
      'https://agents.yclaw.ai/v1/onboarding/github/callback',
    );
    expect(manifest.setup_url).toBe(
      'https://agents.yclaw.ai/v1/onboarding/github/setup',
    );
    expect(manifest.public).toBe(false);
    expect(manifest.default_events).toContain('pull_request');
    expect(manifest.default_events).toContain('workflow_run');

    const perms = manifest.default_permissions as Record<string, string>;
    expect(perms.contents).toBe('write');
    expect(perms.issues).toBe('write');
    expect(perms.pull_requests).toBe('write');
    expect(perms.checks).toBe('read');
  });

  it('strips trailing slash from instance URL', async () => {
    const { generateManifest } = await import(
      '../src/onboarding/github-app-manifest.js'
    );

    const manifest = generateManifest('https://agents.yclaw.ai/');
    expect((manifest.hook_attributes as { url: string }).url).toBe(
      'https://agents.yclaw.ai/github/webhook',
    );
  });

  it('generates unique names on each call', async () => {
    const { generateManifest } = await import(
      '../src/onboarding/github-app-manifest.js'
    );

    const m1 = generateManifest('https://a.com');
    const m2 = generateManifest('https://a.com');
    expect(m1.name).not.toBe(m2.name);
  });
});
