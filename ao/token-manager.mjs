import { createAppAuth } from '@octokit/auth-app';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

function getTokenCachePath() {
  if (process.env.GITHUB_APP_TOKEN_CACHE_PATH) {
    return process.env.GITHUB_APP_TOKEN_CACHE_PATH;
  }

  // Prefer HOME so root startup and the ao runtime do not fight over one
  // shared cache file. They can each keep their own short-lived token cache.
  const baseDir = process.env.HOME || process.env.AO_HOME || tmpdir();
  return join(baseDir, '.github-app-token.json');
}

const TOKEN_CACHE_PATH = getTokenCachePath();
const REFRESH_BUFFER_MS = 10 * 60 * 1000; // Refresh when <10 min left

let authInstance = null;

function getAuth() {
  if (!authInstance) {
    authInstance = createAppAuth({
      appId: process.env.GITHUB_APP_ID,
      privateKey: process.env.GITHUB_APP_PRIVATE_KEY,
      installationId: process.env.GITHUB_APP_INSTALLATION_ID,
    });
  }
  return authInstance;
}

async function getToken() {
  // Check cache first
  if (existsSync(TOKEN_CACHE_PATH)) {
    try {
      const cached = JSON.parse(readFileSync(TOKEN_CACHE_PATH, 'utf-8'));
      const expiresAt = new Date(cached.expiresAt).getTime();
      const now = Date.now();
      // Use cached token if >10 min remaining
      if (expiresAt - now > REFRESH_BUFFER_MS) {
        return cached.token;
      }
    } catch {}
  }

  // Fetch fresh token
  const auth = getAuth();
  const { token, expiresAt } = await auth({ type: 'installation' });

  // Cache it
  mkdirSync(dirname(TOKEN_CACHE_PATH), { recursive: true });
  writeFileSync(TOKEN_CACHE_PATH, JSON.stringify({ token, expiresAt }), 'utf-8');

  return token;
}

// CLI interface: `node token-manager.mjs get-token`
const command = process.argv[2];
if (command === 'get-token') {
  const token = await getToken();
  process.stdout.write(token);
}

export { getToken };
