/**
 * AWS Secrets Manager secret backend.
 *
 * Stores credentials in AWS Secrets Manager with a configurable prefix.
 * Each secret is stored as a JSON string under the key:
 *   {prefix}{integration}/{groupId}
 *
 * Requires:
 *  - AWS credentials configured (env vars, IAM role, or profile)
 *  - AWS_SECRETS_PREFIX env var (defaults to 'yclaw/integrations/')
 *  - AWS_REGION env var (defaults to 'us-east-1')
 */

import { randomUUID } from 'crypto';
import type { SecretBackend } from '../secret-backend.js';

export class AWSSecretsBackend implements SecretBackend {
  private readonly prefix: string;
  private readonly region: string;
  // Dynamic import — typed at usage sites
  private client: any = null;

  constructor() {
    this.prefix = process.env.AWS_SECRETS_PREFIX ?? 'yclaw/integrations/';
    this.region = process.env.AWS_REGION ?? 'us-east-1';
  }

  private async getClient(): Promise<any> {
    if (this.client) return this.client;
    const { SecretsManagerClient } = await import('@aws-sdk/client-secrets-manager');
    this.client = new SecretsManagerClient({ region: this.region });
    return this.client;
  }

  private secretName(integration: string, groupId: string): string {
    return `${this.prefix}${integration}/${groupId}`;
  }

  async store(integration: string, fields: Record<string, string>): Promise<string> {
    const client = await this.getClient();
    const { CreateSecretCommand, UpdateSecretCommand } = await import('@aws-sdk/client-secrets-manager');
    const groupId = randomUUID();
    const name = this.secretName(integration, groupId);
    const secretString = JSON.stringify(fields);

    try {
      await client.send(new CreateSecretCommand({
        Name: name,
        SecretString: secretString,
        Tags: [
          { Key: 'integration', Value: integration },
          { Key: 'groupId', Value: groupId },
          { Key: 'managedBy', Value: 'yclaw' },
        ],
      }));
    } catch (err: unknown) {
      if ((err as { name?: string }).name === 'ResourceExistsException') {
        await client.send(new UpdateSecretCommand({
          SecretId: name,
          SecretString: secretString,
        }));
      } else {
        throw err;
      }
    }

    return groupId;
  }

  async retrieve(ref: string): Promise<Record<string, string> | null> {
    const client = await this.getClient();
    const { GetSecretValueCommand } = await import('@aws-sdk/client-secrets-manager');

    // Try all secrets with this prefix to find the right group
    const { ListSecretsCommand } = await import('@aws-sdk/client-secrets-manager');
    const listRes = await client.send(new ListSecretsCommand({
      Filters: [{ Key: 'tag-key', Values: ['groupId'] }, { Key: 'tag-value', Values: [ref] }],
    }));

    const secretName = listRes.SecretList?.[0]?.Name;
    if (!secretName) return null;

    const res = await client.send(new GetSecretValueCommand({ SecretId: secretName }));
    if (!res.SecretString) return null;
    return JSON.parse(res.SecretString);
  }

  async retrieveField(scopedRef: string): Promise<string | null> {
    // scopedRef: integrations/{integration}/{groupId}/{field}
    const parts = scopedRef.split('/');
    if (parts.length < 4) return null;
    const groupId = parts[2]!;
    const field = parts[3]!;

    const allFields = await this.retrieve(groupId);
    if (!allFields) return null;
    return allFields[field] ?? null;
  }

  async delete(ref: string): Promise<void> {
    const client = await this.getClient();
    const { DeleteSecretCommand, ListSecretsCommand } = await import('@aws-sdk/client-secrets-manager');

    const listRes = await client.send(new ListSecretsCommand({
      Filters: [{ Key: 'tag-key', Values: ['groupId'] }, { Key: 'tag-value', Values: [ref] }],
    }));

    for (const secret of listRes.SecretList ?? []) {
      if (secret.Name) {
        await client.send(new DeleteSecretCommand({
          SecretId: secret.Name,
          ForceDeleteWithoutRecovery: true,
        }));
      }
    }
  }

  async list(): Promise<string[]> {
    const client = await this.getClient();
    const { ListSecretsCommand } = await import('@aws-sdk/client-secrets-manager');

    const res = await client.send(new ListSecretsCommand({
      Filters: [{ Key: 'name', Values: [this.prefix] }],
    }));

    const groupIds = new Set<string>();
    for (const secret of res.SecretList ?? []) {
      const tag = secret.Tags?.find((t: { Key?: string; Value?: string }) => t.Key === 'groupId');
      if (tag?.Value) groupIds.add(tag.Value);
    }
    return Array.from(groupIds);
  }
}
