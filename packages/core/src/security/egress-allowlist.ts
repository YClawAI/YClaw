/**
 * YCLAW Agent Network Egress Allowlist
 *
 * Agent containers should only reach approved endpoints.
 * Enforced at the network policy layer (ECS/K8s) and audited in application code.
 */

export const AGENT_EGRESS_ALLOWLIST = [
  // LLM providers
  'api.anthropic.com:443',
  'api.openai.com:443',
  'generativelanguage.googleapis.com:443',
  'api.x.ai:443',

  // Code hosting
  'api.github.com:443',
  'github.com:443',

  // Package registry
  'registry.npmjs.org:443',

  // AWS services (for secrets manager, S3, ECR)
  '*.amazonaws.com:443',

  // Package security
  'api.socket.dev:443',
] as const;

export type AllowedEndpoint = (typeof AGENT_EGRESS_ALLOWLIST)[number];

/**
 * Check if a given hostname:port is in the egress allowlist.
 * Supports wildcard matching (e.g., *.amazonaws.com).
 */
export function isEgressAllowed(endpoint: string): boolean {
  return AGENT_EGRESS_ALLOWLIST.some(allowed => {
    if (allowed.startsWith('*.')) {
      const suffix = allowed.slice(1); // e.g., ".amazonaws.com:443"
      return endpoint.endsWith(suffix);
    }
    return endpoint === allowed;
  });
}
