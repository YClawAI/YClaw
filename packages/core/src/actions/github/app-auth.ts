/**
 * GitHub App Authentication Provider
 *
 * Handles two auth methods with automatic fallback:
 *   1. GitHub App — JWT + installation access token (auto-refreshing)
 *   2. Personal Access Token (PAT) — from GITHUB_TOKEN env var
 *
 * Installation tokens expire after 60 minutes. This module caches them
 * and refreshes at 55 minutes to avoid mid-request expiry.
 *
 * The private key can be provided in three formats:
 *   - Raw PEM string (multi-line, starts with -----BEGIN)
 *   - Base64-encoded PEM (single line, for Secrets Manager / K8s)
 *   - File path (e.g., /secrets/github-app.pem)
 */

import { SignJWT, importPKCS8 } from 'jose';
import { readFileSync, existsSync } from 'node:fs';
import { createLogger } from '../../logging/logger.js';

const logger = createLogger('github-app-auth');

// ─── Types ──────────────────────────────────────────────────────────────────

interface InstallationToken {
  token: string;
  expiresAt: number; // epoch ms
}

type AuthMethod = 'app' | 'pat' | 'none';

// ─── Configuration ──────────────────────────────────────────────────────────

/** Refresh tokens 5 minutes before expiry to avoid mid-request failures. */
const REFRESH_MARGIN_MS = 5 * 60 * 1000;

/** JWT lifetime — GitHub rejects JWTs older than 10 minutes. */
const JWT_EXPIRY_SECONDS = 600;

// ─── Module State ───────────────────────────────────────────────────────────

let _cachedToken: InstallationToken | null = null;
let _refreshPromise: Promise<string> | null = null;
let _authMethod: AuthMethod = 'none';
let _initialized = false;

// ─── Private Key Resolution ─────────────────────────────────────────────────

/**
 * Resolve the private key from env var to a PEM string.
 * Supports three formats:
 *   1. Raw PEM string (contains -----BEGIN)
 *   2. Base64-encoded PEM
 *   3. File path
 */
function resolvePrivateKey(raw: string): string {
  // Format 1: Raw PEM
  if (raw.includes('-----BEGIN')) {
    return raw;
  }

  // Format 3: File path — check before base64 since a path like
  // /secrets/key.pem won't decode as valid base64 PEM anyway
  if ((raw.startsWith('/') || raw.startsWith('./')) && existsSync(raw)) {
    const content = readFileSync(raw, 'utf-8');
    if (!content.includes('-----BEGIN')) {
      throw new Error(`File ${raw} does not contain a valid PEM key`);
    }
    return content;
  }

  // Format 2: Base64-encoded PEM
  try {
    const decoded = Buffer.from(raw, 'base64').toString('utf-8');
    if (decoded.includes('-----BEGIN')) {
      return decoded;
    }
  } catch {
    // Not valid base64 — fall through
  }

  throw new Error(
    'GITHUB_APP_PRIVATE_KEY must be a PEM string, base64-encoded PEM, or file path',
  );
}

// ─── JWT Generation ─────────────────────────────────────────────────────────

/**
 * Generate a short-lived JWT signed with the App's private key.
 * Used to authenticate as the GitHub App itself (not as an installation).
 */
async function generateJWT(appId: string, privateKeyPem: string): Promise<string> {
  const privateKey = await importPKCS8(privateKeyPem, 'RS256');
  const now = Math.floor(Date.now() / 1000);

  return new SignJWT({})
    .setProtectedHeader({ alg: 'RS256' })
    .setIssuedAt(now - 60) // 60s clock skew allowance
    .setExpirationTime(now + JWT_EXPIRY_SECONDS)
    .setIssuer(appId)
    .sign(privateKey);
}

// ─── Installation Token Exchange ────────────────────────────────────────────

/**
 * Exchange a JWT for an installation access token.
 * POST /app/installations/{installation_id}/access_tokens
 */
async function exchangeForInstallationToken(
  jwt: string,
  installationId: string,
): Promise<InstallationToken> {
  const url = `https://api.github.com/app/installations/${installationId}/access_tokens`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Accept': 'application/vnd.github+json',
      'Authorization': `Bearer ${jwt}`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Failed to create installation token (${response.status}): ${body}`,
    );
  }

  const data = (await response.json()) as { token: string; expires_at: string };

  return {
    token: data.token,
    expiresAt: new Date(data.expires_at).getTime(),
  };
}

// ─── Token Cache & Refresh ──────────────────────────────────────────────────

function isTokenFresh(): boolean {
  if (!_cachedToken) return false;
  return _cachedToken.expiresAt - Date.now() > REFRESH_MARGIN_MS;
}

/**
 * Get a fresh installation token. Uses cached token if still valid,
 * otherwise generates a new JWT and exchanges it.
 *
 * Thread-safe: concurrent callers share the same in-flight refresh promise.
 */
async function getInstallationToken(): Promise<string> {
  if (_cachedToken && isTokenFresh()) {
    return _cachedToken.token;
  }

  // Dedup concurrent refresh requests
  if (_refreshPromise) {
    return _refreshPromise;
  }

  const appId = process.env.GITHUB_APP_ID!;
  const privateKeyRaw = process.env.GITHUB_APP_PRIVATE_KEY!;
  const installationId = process.env.GITHUB_APP_INSTALLATION_ID!;

  _refreshPromise = (async () => {
    try {
      const pem = resolvePrivateKey(privateKeyRaw);
      const jwt = await generateJWT(appId, pem);
      const installationToken = await exchangeForInstallationToken(jwt, installationId);
      _cachedToken = installationToken;
      logger.info('GitHub App installation token refreshed', {
        expiresAt: new Date(installationToken.expiresAt).toISOString(),
      });
      return installationToken.token;
    } finally {
      _refreshPromise = null;
    }
  })();

  return _refreshPromise;
}

// ─── Auth Method Detection ──────────────────────────────────────────────────

function detectAuthMethod(): AuthMethod {
  const hasApp =
    !!process.env.GITHUB_APP_ID &&
    !!process.env.GITHUB_APP_PRIVATE_KEY &&
    !!process.env.GITHUB_APP_INSTALLATION_ID;

  if (hasApp) return 'app';
  if (process.env.GITHUB_TOKEN) return 'pat';
  return 'none';
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Initialize the auth provider and log which method is active.
 * Called automatically on first use, but can be called explicitly at startup.
 */
export function initGitHubAuth(): AuthMethod {
  _authMethod = detectAuthMethod();
  _initialized = true;

  if (_authMethod === 'app') {
    logger.info('GitHub auth: using GitHub App (auto-refreshing installation tokens)');
  } else if (_authMethod === 'pat') {
    logger.info('GitHub auth: using Personal Access Token (GITHUB_TOKEN)');
  } else {
    logger.warn('GitHub auth: no credentials configured (GITHUB_APP_* or GITHUB_TOKEN)');
  }

  return _authMethod;
}

/**
 * Get a valid GitHub token. Returns either:
 *   - An installation access token (GitHub App)
 *   - A PAT (GITHUB_TOKEN env var)
 *   - Throws if neither is configured
 *
 * Token is cached and auto-refreshed. Safe to call on every request.
 */
export async function getGitHubToken(): Promise<string> {
  if (!_initialized) initGitHubAuth();

  switch (_authMethod) {
    case 'app':
      return getInstallationToken();
    case 'pat':
      return process.env.GITHUB_TOKEN!;
    case 'none':
      throw new Error(
        'No GitHub credentials configured. Set GITHUB_APP_ID + GITHUB_APP_PRIVATE_KEY + GITHUB_APP_INSTALLATION_ID, or GITHUB_TOKEN.',
      );
  }
}

/**
 * Check if any GitHub auth method is available.
 */
export function isGitHubAuthAvailable(): boolean {
  if (!_initialized) initGitHubAuth();
  return _authMethod !== 'none';
}

/**
 * Get the current auth method.
 */
export function getAuthMethod(): AuthMethod {
  if (!_initialized) initGitHubAuth();
  return _authMethod;
}

/**
 * Create an Octokit-compatible auth token string for use with `new Octokit({ auth })`.
 * This is a convenience wrapper — Octokit accepts a plain token string.
 */
export async function getOctokitAuth(): Promise<string> {
  return getGitHubToken();
}

// ─── Test Helpers ───────────────────────────────────────────────────────────

/** Reset internal state (for tests only). */
export function _resetForTesting(): void {
  _cachedToken = null;
  _refreshPromise = null;
  _authMethod = 'none';
  _initialized = false;
}

// Re-export for tests
export { resolvePrivateKey as _resolvePrivateKey };
export type { AuthMethod };
