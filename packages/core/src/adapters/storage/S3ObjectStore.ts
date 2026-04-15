/**
 * S3ObjectStore — AWS S3 adapter for IObjectStore.
 *
 * For production deployments on AWS. Requires @aws-sdk/client-s3
 * (optional peer dependency) and optionally @aws-sdk/s3-request-presigner
 * for signed URLs.
 */

import type {
  IObjectStore,
  ObjectMetadata,
  PutOptions,
  ListResult,
} from '../../interfaces/IObjectStore.js';
import { createLogger } from '../../logging/logger.js';

const logger = createLogger('s3-object-store');

/**
 * Dynamic import helper that bypasses TypeScript module resolution.
 * Used for optional peer dependencies that may not be installed.
 */
// eslint-disable-next-line @typescript-eslint/no-implied-eval
const dynamicImport = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<any>;

export class S3ObjectStore implements IObjectStore {
  private client: any = null;
  private s3Module: any = null;
  private readonly bucket: string;
  private readonly prefix: string;
  private readonly region: string;

  /**
   * @param bucket - S3 bucket name
   * @param prefix - Key prefix (e.g., 'yclaw/' for namespacing)
   * @param region - AWS region (default: AWS_REGION env var or 'us-east-1')
   */
  constructor(bucket?: string, prefix?: string, region?: string) {
    this.bucket = bucket || process.env.YCLAW_S3_BUCKET || '';
    this.prefix = prefix || process.env.YCLAW_S3_PREFIX || '';
    this.region = region || process.env.AWS_REGION || 'us-east-1';

    if (!this.bucket) {
      logger.warn('S3ObjectStore: no bucket configured (set YCLAW_S3_BUCKET)');
    }
  }

  private async ensureClient(): Promise<void> {
    if (this.client) return;

    try {
      this.s3Module = await dynamicImport('@aws-sdk/client-s3');
      this.client = new this.s3Module.S3Client({
        region: this.region,
      });
    } catch {
      throw new Error(
        'S3ObjectStore requires @aws-sdk/client-s3. ' +
        'Install it: npm install @aws-sdk/client-s3',
      );
    }
  }

  private fullKey(key: string): string {
    return `${this.prefix}${key}`;
  }

  async put(key: string, data: Buffer, options?: PutOptions): Promise<void> {
    await this.ensureClient();

    await this.client.send(new this.s3Module.PutObjectCommand({
      Bucket: this.bucket,
      Key: this.fullKey(key),
      Body: data,
      ContentType: options?.contentType,
      Metadata: options?.metadata,
    }));

    logger.info('S3 object stored', { key, size: data.length, bucket: this.bucket });
  }

  async get(key: string): Promise<Buffer | null> {
    await this.ensureClient();

    try {
      const response = await this.client.send(new this.s3Module.GetObjectCommand({
        Bucket: this.bucket,
        Key: this.fullKey(key),
      }));

      const chunks: Uint8Array[] = [];
      for await (const chunk of response.Body) {
        chunks.push(chunk);
      }
      return Buffer.concat(chunks);
    } catch (err: unknown) {
      const awsErr = err as { name?: string; $metadata?: { httpStatusCode?: number } };
      if (awsErr.name === 'NoSuchKey' || awsErr.$metadata?.httpStatusCode === 404) {
        return null;
      }
      throw err;
    }
  }

  async head(key: string): Promise<ObjectMetadata | null> {
    await this.ensureClient();

    try {
      const response = await this.client.send(new this.s3Module.HeadObjectCommand({
        Bucket: this.bucket,
        Key: this.fullKey(key),
      }));

      return {
        contentType: response.ContentType,
        contentLength: response.ContentLength,
        lastModified: response.LastModified?.toISOString(),
        custom: response.Metadata,
      };
    } catch (err: unknown) {
      const awsErr = err as { name?: string; $metadata?: { httpStatusCode?: number } };
      if (awsErr.name === 'NotFound' || awsErr.$metadata?.httpStatusCode === 404) {
        return null;
      }
      throw err;
    }
  }

  async delete(key: string): Promise<void> {
    await this.ensureClient();

    await this.client.send(new this.s3Module.DeleteObjectCommand({
      Bucket: this.bucket,
      Key: this.fullKey(key),
    }));

    logger.info('S3 object deleted', { key, bucket: this.bucket });
  }

  async list(prefix?: string, maxKeys?: number): Promise<ListResult> {
    await this.ensureClient();
    const max = maxKeys || 1000;
    const fullPrefix = prefix ? `${this.prefix}${prefix}` : this.prefix;

    const response = await this.client.send(new this.s3Module.ListObjectsV2Command({
      Bucket: this.bucket,
      Prefix: fullPrefix,
      MaxKeys: max,
    }));

    const keys = (response.Contents || [])
      .map((obj: { Key?: string }) => obj.Key?.slice(this.prefix.length) ?? '')
      .filter(Boolean);

    return {
      keys,
      truncated: response.IsTruncated ?? false,
    };
  }

  async getSignedUrl(key: string, expiresInSeconds?: number): Promise<string | null> {
    await this.ensureClient();

    try {
      const presigner = await dynamicImport('@aws-sdk/s3-request-presigner');

      const url = await presigner.getSignedUrl(
        this.client,
        new this.s3Module.GetObjectCommand({
          Bucket: this.bucket,
          Key: this.fullKey(key),
        }),
        { expiresIn: expiresInSeconds || 3600 },
      );

      return url;
    } catch (err: unknown) {
      logger.warn('Failed to generate signed URL', {
        key,
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }
}
