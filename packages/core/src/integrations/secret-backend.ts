/**
 * Pluggable secret backend interface for integration credentials.
 *
 * Implementations:
 *  - MongoSecretBackend  (default — MongoDB with AES-256-GCM)
 *  - EnvSecretBackend    (writes to .env.integrations for local dev)
 *  - EncryptedFileBackend (self-hosted, file-based with master key)
 *
 * Configure via SECRET_BACKEND env var: 'mongodb' | 'env' | 'file'
 */

export interface SecretBackend {
  /** Store credential fields, returning a reference ID. */
  store(integration: string, fields: Record<string, string>): Promise<string>;
  /** Retrieve all fields by reference ID. */
  retrieve(ref: string): Promise<Record<string, string> | null>;
  /** Retrieve a single field by scoped ref (e.g., integrations/{name}/{field}). */
  retrieveField(scopedRef: string): Promise<string | null>;
  /** Delete a secret by reference ID. */
  delete(ref: string): Promise<void>;
  /** List all stored integration secret references. */
  list(): Promise<string[]>;
}

export type SecretBackendType = 'mongodb' | 'aws' | 'env' | 'file';

/**
 * Resolve a SecretBackend implementation from the SECRET_BACKEND env var.
 * Falls back to 'mongodb' if not set or invalid.
 */
export async function resolveSecretBackend(): Promise<SecretBackend> {
  const backendType = (process.env.SECRET_BACKEND ?? 'mongodb') as SecretBackendType;

  switch (backendType) {
    case 'aws': {
      const { AWSSecretsBackend } = await import('./secret-backends/aws.js');
      return new AWSSecretsBackend();
    }
    case 'env': {
      const { EnvSecretBackend } = await import('./secret-backends/env.js');
      return new EnvSecretBackend();
    }
    case 'file': {
      const { EncryptedFileBackend } = await import('./secret-backends/file.js');
      return new EncryptedFileBackend();
    }
    case 'mongodb':
    default: {
      const { MongoSecretBackend } = await import('./secret-backends/mongo.js');
      return new MongoSecretBackend();
    }
  }
}
