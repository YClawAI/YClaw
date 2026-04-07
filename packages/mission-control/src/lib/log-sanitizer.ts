/**
 * Regex-based credential redaction for log output.
 * Prevents secrets from leaking into application logs.
 */

const PATTERNS: [RegExp, string][] = [
  // GitHub tokens
  [/ghp_[A-Za-z0-9_]{36,}/g, 'ghp_***'],
  [/github_pat_[A-Za-z0-9_]{22,}/g, 'github_pat_***'],
  // Slack tokens
  [/xoxb-[A-Za-z0-9\-]{10,}/g, 'xoxb-***'],
  [/xoxp-[A-Za-z0-9\-]{10,}/g, 'xoxp-***'],
  [/xapp-[A-Za-z0-9\-]{10,}/g, 'xapp-***'],
  // Generic sk- tokens (OpenAI, Anthropic, etc.)
  [/sk-[A-Za-z0-9\-_]{20,}/g, 'sk-***'],
  // Figma tokens
  [/figd_[A-Za-z0-9_\-]{20,}/g, 'figd_***'],
  // Linear API keys
  [/lin_api_[A-Za-z0-9_\-]{20,}/g, 'lin_api_***'],
  // Linear webhook secrets
  [/lin_wh_[A-Za-z0-9_\-]{10,}/g, 'lin_wh_***'],
  // Bearer tokens in headers
  [/Bearer\s+[A-Za-z0-9\-._~+/]+=*/g, 'Bearer ***'],
];

export function sanitize(input: string): string {
  let result = input;
  for (const [pattern, replacement] of PATTERNS) {
    result = result.replace(pattern, replacement);
  }
  return result;
}
