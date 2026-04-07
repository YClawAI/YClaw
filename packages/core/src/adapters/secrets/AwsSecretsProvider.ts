/**
 * AwsSecretsProvider — AWS Secrets Manager adapter for ISecretProvider.
 *
 * Reads secrets from AWS Secrets Manager. Each YCLAW secret key maps to
 * a Secrets Manager secret name (optionally prefixed).
 *
 * Requires: @aws-sdk/client-secrets-manager (optional peer dependency).
 */

import type { ISecretProvider } from '../../interfaces/ISecretProvider.js';
import { createLogger } from '../../logging/logger.js';

const logger = createLogger('aws-secrets-provider');

/**
 * Dynamic import helper that bypasses TypeScript module resolution.
 * Used for optional peer dependencies that may not be installed.
 */
// eslint-disable-next-line @typescript-eslint/no-implied-eval
const dynamicImport = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<any>;

export class AwsSecretsProvider implements ISecretProvider {
  private client: any = null;
  private smModule: any = null;
  private readonly prefix: string;
  private readonly region: string;
  private readonly cache = new Map<string, string>();

  /**
   * @param prefix - Prefix for secret names in Secrets Manager (e.g., 'yclaw/production/')
   * @param region - AWS region (default: AWS_REGION env var or 'us-east-1')
   */
  constructor(prefix?: string, region?: string) {
    this.prefix = prefix || process.env.AWS_SECRET_PREFIX || 'yclaw/';
    this.region = region || process.env.AWS_REGION || 'us-east-1';
  }

  private async ensureClient(): Promise<void> {
    if (this.client) return;

    try {
      this.smModule = await dynamicImport('@aws-sdk/client-secrets-manager');
      this.client = new this.smModule.SecretsManagerClient({
        region: this.region,
      });
    } catch {
      throw new Error(
        'AWS Secrets Manager requires @aws-sdk/client-secrets-manager. ' +
        'Install it: npm install @aws-sdk/client-secrets-manager',
      );
    }
  }

  async get(key: string): Promise<string | null> {
    // Check cache first
    const cached = this.cache.get(key);
    if (cached !== undefined) return cached;

    await this.ensureClient();

    try {
      const response = await this.client.send(
        new this.smModule.GetSecretValueCommand({ SecretId: `${this.prefix}${key}` }),
      );

      const value = response.SecretString ?? null;
      if (value !== null) {
        this.cache.set(key, value);
      }
      return value;
    } catch (err: any) {
      if (err.name === 'ResourceNotFoundException') {
        return null;
      }
      logger.error('Failed to retrieve secret from AWS', {
        key,
        error: err.message,
      });
      return null;
    }
  }

  async getRequired(key: string): Promise<string> {
    const value = await this.get(key);
    if (value === null) {
      throw new Error(`Required secret "${this.prefix}${key}" not found in AWS Secrets Manager`);
    }
    return value;
  }

  async list(): Promise<string[]> {
    await this.ensureClient();

    try {
      const response = await this.client.send(
        new this.smModule.ListSecretsCommand({
          Filters: [{ Key: 'name', Values: [this.prefix] }],
        }),
      );

      return (response.SecretList || [])
        .map((s: any) => s.Name?.replace(this.prefix, '') ?? '')
        .filter(Boolean);
    } catch (err: any) {
      logger.error('Failed to list secrets from AWS', { error: err.message });
      return [];
    }
  }

  async has(key: string): Promise<boolean> {
    const value = await this.get(key);
    return value !== null;
  }
}
