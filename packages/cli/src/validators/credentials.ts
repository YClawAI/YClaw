/**
 * Credential format validation (regex only — no network calls in Phase 2).
 */

import type { DoctorCheckResult } from '../types.js';

interface CredentialCheck {
  id: string;
  title: string;
  envVar: string;
  pattern?: RegExp;
  critical: boolean;
}

const CHECKS: CredentialCheck[] = [
  {
    id: 'anthropic-key',
    title: 'ANTHROPIC_API_KEY format',
    envVar: 'ANTHROPIC_API_KEY',
    pattern: /^sk-ant-/,
    // critical is set dynamically based on whether this key is required
    critical: true,
  },
  {
    id: 'openai-key',
    title: 'OPENAI_API_KEY format',
    envVar: 'OPENAI_API_KEY',
    pattern: /^sk-/,
    critical: true,
  },
  {
    id: 'openrouter-key',
    title: 'OPENROUTER_API_KEY format',
    envVar: 'OPENROUTER_API_KEY',
    critical: true,
  },
  {
    id: 'slack-token',
    title: 'SLACK_BOT_TOKEN format',
    envVar: 'SLACK_BOT_TOKEN',
    pattern: /^xoxb-/,
    critical: true,
  },
  {
    id: 'telegram-token',
    title: 'TELEGRAM_BOT_TOKEN set',
    envVar: 'TELEGRAM_BOT_TOKEN',
    critical: true,
  },
  {
    id: 'discord-token',
    title: 'DISCORD_BOT_TOKEN set',
    envVar: 'DISCORD_BOT_TOKEN',
    critical: true,
  },
  {
    id: 'twitter-key',
    title: 'TWITTER_APP_KEY set',
    envVar: 'TWITTER_APP_KEY',
    critical: true,
  },
];

export function checkCredential(
  envVar: string,
  value: string | undefined,
): DoctorCheckResult | null {
  const check = CHECKS.find(c => c.envVar === envVar);
  if (!check) return null;

  if (!value || value.trim() === '') {
    return {
      id: check.id,
      title: check.title,
      status: 'fail',  // Missing required creds must block deploy (H3)
      what: `${check.envVar} is not set`,
      why: 'Required for the configured provider/channel',
      fix: `Set ${check.envVar} in .env`,
      critical: check.critical,
    };
  }

  if (check.pattern && !check.pattern.test(value)) {
    return {
      id: check.id,
      title: check.title,
      status: 'warn',
      what: `${check.envVar} has unexpected format`,
      why: `Expected to match ${check.pattern}`,
      fix: `Verify ${check.envVar} is correct`,
      critical: check.critical,
    };
  }

  return {
    id: check.id,
    title: check.title,
    status: 'pass',
    what: `${check.envVar} is set and formatted correctly`,
    critical: check.critical,
  };
}

export function checkRequiredCredentials(
  required: string[],
  env: Record<string, string | undefined>,
): DoctorCheckResult[] {
  const results: DoctorCheckResult[] = [];
  for (const key of required) {
    const result = checkCredential(key, env[key]);
    if (result) results.push(result);
  }
  return results;
}
