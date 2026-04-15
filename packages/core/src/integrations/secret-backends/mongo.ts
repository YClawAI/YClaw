/**
 * MongoDB secret backend — AES-256-GCM encrypted at rest in MongoDB.
 * This is the default backend, extracted from the Phase 1 connections.ts.
 *
 * Requires:
 *  - MONGODB_URI env var (any MongoDB — Atlas, local, Docker)
 *  - INTEGRATION_SECRET_KEY env var (64-char hex = 256-bit AES key)
 */

import { randomUUID, createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import type { SecretBackend } from '../secret-backend.js';

const SECRETS_COLLECTION = 'integration_secrets';

function getEncryptionKey(): Buffer {
  const hex = process.env.INTEGRATION_SECRET_KEY;
  if (!hex || hex.length !== 64) {
    throw new Error(
      'INTEGRATION_SECRET_KEY must be a 64-char hex string. ' +
      'Generate: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"',
    );
  }
  return Buffer.from(hex, 'hex');
}

function encrypt(fields: Record<string, string>): { ciphertext: string; iv: string; tag: string } {
  const key = getEncryptionKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  let encrypted = cipher.update(JSON.stringify(fields), 'utf8', 'base64');
  encrypted += cipher.final('base64');
  return {
    ciphertext: encrypted,
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
  };
}

function decrypt(data: { ciphertext: string; iv: string; tag: string }): Record<string, string> {
  const key = getEncryptionKey();
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(data.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(data.tag, 'base64'));
  let decrypted = decipher.update(data.ciphertext, 'base64', 'utf8');
  decrypted += decipher.final('utf8');
  return JSON.parse(decrypted);
}

export class MongoSecretBackend implements SecretBackend {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic import; typed usage below
  private db: any = null;

  private async getDb(): Promise<any> {
    if (this.db) return this.db;
    // Dynamic import to avoid bundling MongoDB client in non-Mongo environments
    try {
      const { MongoClient } = await import('mongodb');
      const uri = process.env.MONGODB_URI ?? 'mongodb://localhost:27017/yclaw';
      const client = new MongoClient(uri);
      await client.connect();
      this.db = client.db();
      return this.db;
    } catch {
      throw new Error('MongoDB unavailable — set MONGODB_URI or use a different SECRET_BACKEND');
    }
  }

  async store(integration: string, fields: Record<string, string>): Promise<string> {
    const db = await this.getDb();
    const groupId = randomUUID();
    const fieldRefs: Record<string, string> = {};

    // Store per-field scoped secrets (scoped by groupId to avoid overwrites on reconnect)
    for (const [key, value] of Object.entries(fields)) {
      if (!value) continue;
      const fieldRef = `integrations/${integration}/${groupId}/${key}`;
      const encrypted = encrypt({ [key]: value });
      await db.collection(SECRETS_COLLECTION).insertOne({
        _id: fieldRef,
        integration,
        fieldKey: key,
        groupId,
        encrypted,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      fieldRefs[key] = fieldRef;
    }

    // Store group blob for backward compat
    const encrypted = encrypt(fields);
    await db.collection(SECRETS_COLLECTION).insertOne({
      _id: groupId,
      integration,
      fieldRefs,
      encrypted,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    return groupId;
  }

  async retrieve(ref: string): Promise<Record<string, string> | null> {
    const db = await this.getDb();
    const doc = await db.collection(SECRETS_COLLECTION).findOne({ _id: ref });
    if (!doc) return null;
    if (doc.encrypted) return decrypt(doc.encrypted);
    return doc.fields ?? null;
  }

  async retrieveField(scopedRef: string): Promise<string | null> {
    const db = await this.getDb();
    const doc = await db.collection(SECRETS_COLLECTION).findOne({ _id: scopedRef });
    if (!doc?.encrypted) return null;
    const fields = decrypt(doc.encrypted);
    const key = doc.fieldKey as string | undefined;
    if (key && fields[key] !== undefined) return fields[key]!;
    const values = Object.values(fields);
    return values[0] ?? null;
  }

  async delete(ref: string): Promise<void> {
    const db = await this.getDb();
    // Delete group + any scoped refs pointing to this group
    await db.collection(SECRETS_COLLECTION).deleteMany({
      $or: [{ _id: ref }, { groupId: ref }],
    });
  }

  async list(): Promise<string[]> {
    const db = await this.getDb();
    const docs = await db.collection(SECRETS_COLLECTION)
      .find({ groupId: { $exists: false }, fieldKey: { $exists: false } })
      .project({ _id: 1 })
      .toArray();
    return docs.map((d: any) => d._id as string);
  }
}
