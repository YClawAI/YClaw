/**
 * Encrypted file secret backend — AES-256-GCM encrypted JSON files.
 *
 * Self-hosted friendly. Stores each integration's credentials as an
 * encrypted JSON file in the secrets directory. Uses a master key
 * from INTEGRATION_SECRET_KEY env var.
 *
 * Requires:
 *  - INTEGRATION_SECRET_KEY env var (64-char hex = 256-bit AES key)
 *  - SECRETS_DIR env var (defaults to ./data/secrets)
 */

import fs from 'node:fs';
import path from 'node:path';
import { randomUUID, createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import type { SecretBackend } from '../secret-backend.js';

interface EncryptedPayload {
  ciphertext: string;
  iv: string;
  tag: string;
}

interface SecretFile {
  id: string;
  integration: string;
  fields: EncryptedPayload;
  fieldRefs: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}

function getKey(): Buffer {
  const hex = process.env.INTEGRATION_SECRET_KEY;
  if (!hex || hex.length !== 64) {
    throw new Error(
      'INTEGRATION_SECRET_KEY must be a 64-char hex string for the file secret backend.',
    );
  }
  return Buffer.from(hex, 'hex');
}

function encrypt(data: Record<string, string>): EncryptedPayload {
  const key = getKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  let ct = cipher.update(JSON.stringify(data), 'utf8', 'base64');
  ct += cipher.final('base64');
  return {
    ciphertext: ct,
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
  };
}

function decrypt(payload: EncryptedPayload): Record<string, string> {
  const key = getKey();
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(payload.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(payload.tag, 'base64'));
  let pt = decipher.update(payload.ciphertext, 'base64', 'utf8');
  pt += decipher.final('utf8');
  return JSON.parse(pt);
}

export class EncryptedFileBackend implements SecretBackend {
  private readonly dir: string;

  constructor(dir?: string) {
    this.dir = dir ?? process.env.SECRETS_DIR ?? path.resolve(process.cwd(), 'data', 'secrets');
    if (!fs.existsSync(this.dir)) {
      fs.mkdirSync(this.dir, { recursive: true });
    }
  }

  private filePath(id: string): string {
    // Sanitize ID to prevent path traversal
    const safe = id.replace(/[^a-zA-Z0-9_-]/g, '_');
    return path.join(this.dir, `${safe}.json`);
  }

  private readFile(id: string): SecretFile | null {
    const fp = this.filePath(id);
    if (!fs.existsSync(fp)) return null;
    return JSON.parse(fs.readFileSync(fp, 'utf-8')) as SecretFile;
  }

  private writeFile(data: SecretFile): void {
    const fp = this.filePath(data.id);
    fs.writeFileSync(fp, JSON.stringify(data, null, 2), 'utf-8');
  }

  async store(integration: string, fields: Record<string, string>): Promise<string> {
    const id = randomUUID();
    const fieldRefs: Record<string, string> = {};
    for (const key of Object.keys(fields)) {
      if (fields[key]) {
        fieldRefs[key] = `integrations/${integration}/${id}/${key}`;
      }
    }

    const data: SecretFile = {
      id,
      integration,
      fields: encrypt(fields),
      fieldRefs,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.writeFile(data);

    return id;
  }

  async retrieve(ref: string): Promise<Record<string, string> | null> {
    const data = this.readFile(ref);
    if (!data) return null;
    return decrypt(data.fields);
  }

  async retrieveField(scopedRef: string): Promise<string | null> {
    // scopedRef: integrations/{integration}/{groupId}/{field}
    const parts = scopedRef.split('/');
    if (parts.length < 3) return null;
    const field = parts.length >= 4 ? parts[3]! : parts[2]!;

    // Scan all files to find matching integration + field
    const files = fs.readdirSync(this.dir).filter((f) => f.endsWith('.json'));
    for (const file of files) {
      const fp = path.join(this.dir, file);
      const data: SecretFile = JSON.parse(fs.readFileSync(fp, 'utf-8'));
      if (data.fieldRefs[field] === scopedRef) {
        const fields = decrypt(data.fields);
        return fields[field] ?? null;
      }
    }
    return null;
  }

  async delete(ref: string): Promise<void> {
    const fp = this.filePath(ref);
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
  }

  async list(): Promise<string[]> {
    if (!fs.existsSync(this.dir)) return [];
    return fs.readdirSync(this.dir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => {
        const data: SecretFile = JSON.parse(fs.readFileSync(path.join(this.dir, f), 'utf-8'));
        return data.id;
      });
  }
}
