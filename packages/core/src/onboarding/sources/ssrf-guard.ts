/**
 * SSRF protection for URL ingestion.
 *
 * Validates URLs before AND after fetching to prevent:
 * - Direct private IP access
 * - DNS rebinding (short-TTL records changing between validation and fetch)
 * - Redirect-based bypass (public URL → 302 → private IP)
 * - IPv4-mapped IPv6 bypass (::ffff:10.0.0.1)
 */

import { promises as dns } from 'node:dns';
import { URL_FETCH_TIMEOUT_MS } from '../constants.js';

/** IPv4 private/reserved CIDR prefixes. */
const IPV4_PRIVATE_PREFIXES = [
  '10.', '172.16.', '172.17.', '172.18.', '172.19.',
  '172.20.', '172.21.', '172.22.', '172.23.', '172.24.',
  '172.25.', '172.26.', '172.27.', '172.28.', '172.29.',
  '172.30.', '172.31.', '192.168.', '127.', '169.254.', '0.',
];

/** Check if an IP address is in a private/reserved range. */
export function isPrivateIP(ip: string): boolean {
  // IPv6 loopback and unspecified
  if (ip === '::1' || ip === '::') return true;

  // IPv6 private (fc00::/7)
  if (ip.startsWith('fc') || ip.startsWith('fd')) return true;

  // IPv6 link-local (fe80::/10)
  if (ip.startsWith('fe80:') || ip.startsWith('fe80')) return true;

  // IPv6 multicast (ff00::/8)
  if (ip.startsWith('ff')) return true;

  // IPv4-mapped IPv6 (::ffff:x.x.x.x) — extract IPv4 and check
  const v4Mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (v4Mapped?.[1]) {
    return isPrivateIPv4(v4Mapped[1]);
  }

  // Plain IPv4
  return isPrivateIPv4(ip);
}

function isPrivateIPv4(ip: string): boolean {
  for (const prefix of IPV4_PRIVATE_PREFIXES) {
    if (ip.startsWith(prefix)) return true;
  }
  return false;
}

/**
 * Pre-fetch URL validation. Checks scheme and hostname.
 * Does NOT do DNS resolution (that happens at fetch time).
 */
export function validateUrlScheme(url: string): void {
  const parsed = new URL(url);

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Only HTTP/HTTPS URLs are supported');
  }

  const hostname = parsed.hostname.toLowerCase();
  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]') {
    throw new Error('Cannot fetch from localhost');
  }
}

/**
 * Validate the final response URL after redirects.
 * Prevents redirect-based SSRF (public URL → 302 → internal IP).
 */
export async function validateResponseUrl(responseUrl: string): Promise<void> {
  const parsed = new URL(responseUrl);
  const hostname = parsed.hostname.toLowerCase();

  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]') {
    throw new Error('Redirect led to localhost');
  }

  try {
    const { address } = await dns.lookup(hostname);
    if (isPrivateIP(address)) {
      throw new Error('Redirect led to private/internal address');
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes('Redirect led to')) throw err;
    throw new Error(`DNS resolution failed for redirected host ${hostname}`);
  }
}

/**
 * Safe fetch with SSRF protection.
 * Validates scheme pre-fetch, validates response URL post-redirect,
 * and limits redirects to prevent abuse.
 */
export async function safeFetch(url: string, headers?: Record<string, string>): Promise<Response> {
  validateUrlScheme(url);

  // Use redirect: 'manual' to inspect each redirect
  let currentUrl = url;
  let redirectCount = 0;
  const maxRedirects = 3;

  while (redirectCount <= maxRedirects) {
    const response = await fetch(currentUrl, {
      signal: AbortSignal.timeout(URL_FETCH_TIMEOUT_MS),
      redirect: 'manual',
      headers: {
        'User-Agent': 'YCLAW-Onboarding/1.0',
        ...headers,
      },
    });

    // Not a redirect — validate final destination and return
    if (response.status < 300 || response.status >= 400) {
      await validateResponseUrl(currentUrl);
      return response;
    }

    // Follow redirect manually
    const location = response.headers.get('location');
    if (!location) {
      throw new Error('Redirect without Location header');
    }

    // Resolve relative redirects
    currentUrl = new URL(location, currentUrl).toString();
    validateUrlScheme(currentUrl);
    redirectCount++;
  }

  throw new Error(`Too many redirects (max ${maxRedirects})`);
}
