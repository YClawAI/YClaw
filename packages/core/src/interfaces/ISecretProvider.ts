/**
 * ISecretProvider — Abstract interface for secrets management.
 *
 * This is a simplified read-only interface for retrieving secrets at runtime.
 * The existing SecretBackend interface (integrations/secret-backend.ts) handles
 * full CRUD for integration credentials and remains unchanged.
 *
 * ISecretProvider is used by the infrastructure layer for bootstrap-time
 * secrets (database URLs, API keys, channel tokens). SecretBackend continues
 * to be used for agent-managed integration credentials.
 */

// ─── ISecretProvider ────────────────────────────────────────────────────────

/**
 * Read-only secrets provider for infrastructure configuration.
 *
 * Adapters:
 * - EnvSecretProvider — reads from process.env (default for local/Docker Compose)
 * - AwsSecretsProvider — reads from AWS Secrets Manager
 * - Future: GcpSecretsProvider, VaultProvider, DopplerProvider
 */
export interface ISecretProvider {
  /**
   * Get a secret value by key.
   * Returns null if the key does not exist.
   */
  get(key: string): Promise<string | null>;

  /**
   * Get a required secret value by key.
   * Throws if the key does not exist.
   */
  getRequired(key: string): Promise<string>;

  /**
   * List available secret keys (if supported by the provider).
   * Returns an empty array if listing is not supported.
   */
  list(): Promise<string[]>;

  /**
   * Check if a specific secret key exists.
   */
  has(key: string): Promise<boolean>;
}
