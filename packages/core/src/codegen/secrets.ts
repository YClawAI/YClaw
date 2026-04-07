import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { createLogger } from '../logging/logger.js';

const logger = createLogger('secrets-scanner');

// ─── Secret Detection & Redaction ───────────────────────────────────────────
//
// Pattern-based secret scanning for:
//   1. Pre-push blocking — prevent secrets from entering PRs
//   2. Log redaction — strip secrets from stdout/stderr before storage
//   3. CLAUDE.md sanitization — prevent secrets in repo docs
//
// Defense-in-depth: this is the LAST line of defense. Credential scoping
// (not passing secrets to subprocesses) is the FIRST line.
//

/** Patterns that match common secret formats */
const SECRET_PATTERNS: ReadonlyArray<{ name: string; pattern: RegExp }> = [
  // API keys (generic)
  { name: 'generic-api-key', pattern: /(?:api[_-]?key|apikey)\s*[:=]\s*['"]?[A-Za-z0-9_\-]{20,}['"]?/gi },

  // Anthropic
  { name: 'anthropic-key', pattern: /sk-ant-[A-Za-z0-9_\-]{20,}/g },

  // OpenAI
  { name: 'openai-key', pattern: /sk-[A-Za-z0-9]{20,}/g },

  // AWS
  { name: 'aws-access-key', pattern: /AKIA[0-9A-Z]{16}/g },
  { name: 'aws-secret-key', pattern: /(?:aws)?[_-]?secret[_-]?(?:access)?[_-]?key\s*[:=]\s*['"]?[A-Za-z0-9/+=]{40}['"]?/gi },

  // GitHub tokens
  { name: 'github-token', pattern: /gh[ps]_[A-Za-z0-9_]{36,}/g },
  { name: 'github-pat', pattern: /github_pat_[A-Za-z0-9_]{22,}/g },

  // MongoDB connection strings
  { name: 'mongodb-uri', pattern: /mongodb(?:\+srv)?:\/\/[^\s'"]+/gi },

  // Redis URLs
  { name: 'redis-url', pattern: /rediss?:\/\/[^\s'"]+/gi },

  // Slack tokens
  { name: 'slack-token', pattern: /xox[bpsar]-[A-Za-z0-9\-]+/g },

  // Telegram bot tokens
  { name: 'telegram-token', pattern: /\d{8,10}:[A-Za-z0-9_-]{35}/g },

  // Git URLs with embedded credentials (https://user:token@host)
  { name: 'git-url-credential', pattern: /https:\/\/[^:\s]+:[^@\s]+@github\.com[^\s'")]*/g },

  // Generic bearer tokens
  { name: 'bearer-token', pattern: /Bearer\s+[A-Za-z0-9_\-.~+/]+=*/g },

  // Private keys
  { name: 'private-key', pattern: /-----BEGIN (?:RSA |EC |DSA )?PRIVATE KEY-----/g },

  // Generic high-entropy strings assigned to known secret variable names
  { name: 'env-secret', pattern: /(?:PASSWORD|SECRET|TOKEN|PRIVATE_KEY|SIGNING_KEY)\s*[:=]\s*['"]?[^\s'"]{8,}['"]?/gi },
];

/** Files to skip during scanning (binary, lock files, etc.) */
const SKIP_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.ico', '.svg', '.woff', '.woff2',
  '.ttf', '.eot', '.mp4', '.webm', '.zip', '.gz', '.tar', '.lock',
  '.map', '.min.js', '.min.css',
]);

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', '.next', '.cache',
]);

/** Max file size to scan (1MB) */
const MAX_SCAN_SIZE = 1024 * 1024;

export interface SecretFinding {
  file: string;
  line: number;
  pattern: string;
  match: string;  // redacted — shows only first 4 + last 2 chars
}

export interface ScanResult {
  clean: boolean;
  findings: SecretFinding[];
}

/**
 * Scan a directory tree for secrets. Returns findings with redacted matches.
 * Used pre-push to block PRs containing secrets.
 */
export function scanDirectory(dirPath: string, basePath?: string): ScanResult {
  const base = basePath || dirPath;
  const findings: SecretFinding[] = [];

  try {
    const entries = readdirSync(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      if (SKIP_DIRS.has(entry.name)) continue;

      const fullPath = join(dirPath, entry.name);

      if (entry.isDirectory()) {
        const sub = scanDirectory(fullPath, base);
        findings.push(...sub.findings);
        continue;
      }

      if (!entry.isFile()) continue;

      const ext = entry.name.slice(entry.name.lastIndexOf('.'));
      if (SKIP_EXTENSIONS.has(ext)) continue;

      try {
        const stat = statSync(fullPath);
        if (stat.size > MAX_SCAN_SIZE) continue;

        const content = readFileSync(fullPath, 'utf-8');
        const fileFindings = scanContent(content, relative(base, fullPath));
        findings.push(...fileFindings);
      } catch {
        // Skip unreadable files
      }
    }
  } catch {
    // Skip unreadable directories
  }

  return { clean: findings.length === 0, findings };
}

/**
 * Scan a string for secrets. Returns findings with redacted matches.
 */
export function scanContent(content: string, filename: string): SecretFinding[] {
  const findings: SecretFinding[] = [];
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    for (const { name, pattern } of SECRET_PATTERNS) {
      // Reset lastIndex for global patterns
      pattern.lastIndex = 0;
      let m;
      while ((m = pattern.exec(line)) !== null) {
        findings.push({
          file: filename,
          line: i + 1,
          pattern: name,
          match: redactValue(m[0]),
        });
      }
    }
  }

  return findings;
}

/**
 * Redact a secret value: show first 4 + last 2 chars, mask the rest.
 * "sk-ant-EXAMPLE00" → "sk-a***00"
 */
export function redactValue(value: string): string {
  if (value.length <= 8) return '***REDACTED***';
  return value.slice(0, 4) + '***' + value.slice(-2);
}

/**
 * Redact all secrets in a string. Used for log sanitization.
 * Replaces each match with [REDACTED:<pattern-name>].
 */
export function redactSecrets(content: string): string {
  let result = content;

  for (const { name, pattern } of SECRET_PATTERNS) {
    pattern.lastIndex = 0;
    result = result.replace(pattern, `[REDACTED:${name}]`);
  }

  return result;
}

/**
 * Sanitize content for CLAUDE.md output.
 * - Redacts secrets
 * - Strips raw stack traces (keep first line only)
 * - Strips raw log dumps
 * - Enforces size cap
 */
export function sanitizeForClaudeMd(
  content: string,
  maxBytes: number = 50_000,
): string {
  let result = redactSecrets(content);

  // Strip multi-line stack traces (keep "Error: message" line, drop "    at ..." lines)
  result = result.replace(
    /(\w*Error: [^\n]+)\n(?:\s+at [^\n]+\n?)+/g,
    '$1\n[stack trace redacted]\n',
  );

  // Strip raw log dumps (lines starting with timestamps or log levels)
  result = result.replace(
    /(?:^|\n)(?:\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}[^\n]*\n){5,}/g,
    '\n[log output redacted — see audit trail for full logs]\n',
  );

  // Enforce size cap
  if (Buffer.byteLength(result, 'utf-8') > maxBytes) {
    // Truncate at UTF-8 boundary
    const buf = Buffer.from(result, 'utf-8');
    result = buf.subarray(0, maxBytes).toString('utf-8');
    result += '\n\n[CLAUDE.md truncated at size limit]\n';
  }

  return result;
}

/**
 * Pre-push secret scan. Returns true if clean, false if secrets found.
 * Logs findings as errors.
 */
export function prePushSecretScan(workspacePath: string): ScanResult {
  logger.info('Running pre-push secret scan', { path: workspacePath });

  const result = scanDirectory(workspacePath);

  if (!result.clean) {
    logger.error('SECRET SCAN FAILED — secrets detected in workspace', {
      findingCount: result.findings.length,
      findings: result.findings.map(f => ({
        file: f.file,
        line: f.line,
        pattern: f.pattern,
        match: f.match,
      })),
    });
  } else {
    logger.info('Secret scan passed', { path: workspacePath });
  }

  return result;
}
