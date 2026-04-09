/**
 * Content sanitizer for public API endpoints.
 * Every piece of data leaving through /public/v1/* passes through this.
 */

const SENSITIVE_PATTERNS: RegExp[] = [
  /sk-[a-zA-Z0-9-_]{20,}/,                // Anthropic/OpenAI keys
  /ghp_[a-zA-Z0-9]{36}/,                  // GitHub PATs
  /github_pat_[a-zA-Z0-9_]{22,}/,         // GitHub fine-grained PATs
  /xox[bsrap]-[a-zA-Z0-9-]+/,             // Slack tokens
  /0x[a-fA-F0-9]{40}/,                    // Ethereum addresses
  /[13][a-km-zA-HJ-NP-Z1-9]{25,34}/,      // Bitcoin addresses
  /mongodb(\+srv)?:\/\/[^\s]+/,            // MongoDB URIs
  /redis:\/\/[^\s]+/,                      // Redis URIs
  /postgres(ql)?:\/\/[^\s]+/,              // Postgres URIs
  /https?:\/\/\d+\.\d+\.\d+\.\d+/,        // Internal IP URLs
  /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/,  // Bare IP addresses
  /arn:aws:[^\s]+/,                        // AWS ARNs
  /subnet-[a-f0-9]+/,                      // AWS subnet IDs
  /sg-[a-f0-9]+/,                          // AWS security group IDs
  /i-[a-f0-9]{8,17}/,                      // AWS instance IDs
  /AKIA[0-9A-Z]{16}/,                      // AWS access keys
  /eyJ[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]{20,}/, // JWT tokens
];

const GENERIC_FALLBACK = 'Agent processing task';
const MAX_SUMMARY_LENGTH = 200;

/**
 * Check if a string contains any sensitive patterns.
 */
export function containsSensitiveContent(text: string): boolean {
  return SENSITIVE_PATTERNS.some((pattern) => pattern.test(text));
}

/**
 * Sanitize a text field. Returns the original text if clean,
 * "[redacted]" if sensitive content is detected, or the fallback
 * for null/undefined.
 */
export function sanitizeField(value: unknown, fallback = ''): string {
  if (value == null) return fallback;
  const text = String(value);
  if (containsSensitiveContent(text)) return '[redacted]';
  return text;
}

/**
 * Sanitize an event summary for public display.
 * Applies denylist, truncates, and verifies clean output.
 */
export function sanitizeEventSummary(raw: unknown): string {
  if (raw == null || String(raw).trim() === '') return GENERIC_FALLBACK;

  let text = String(raw);

  // Replace all sensitive patterns
  for (const pattern of SENSITIVE_PATTERNS) {
    text = text.replace(new RegExp(pattern, 'g'), '[redacted]');
  }

  // Truncate
  if (text.length > MAX_SUMMARY_LENGTH) {
    text = text.slice(0, MAX_SUMMARY_LENGTH - 3) + '...';
  }

  // Final safety check — if redaction left mostly placeholder text, use generic
  const redactedCount = (text.match(/\[redacted\]/g) || []).length;
  if (redactedCount > 2) return GENERIC_FALLBACK;

  return text;
}

/**
 * Round a Date to the nearest minute for privacy.
 */
export function roundToMinute(date: Date | string): string {
  const d = new Date(date);
  d.setSeconds(0, 0);
  return d.toISOString();
}
