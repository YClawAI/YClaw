import type { Collection, Db, Filter, WithId } from 'mongodb';

export const VAULT_DOCUMENTS_COLLECTION = 'vault.documents';
export const VAULT_SCRATCHPADS_COLLECTION = 'vault.scratchpads';

export type VaultCollectionKind = 'document' | 'scratchpad';
export type VaultSearchMode = 'text' | 'semantic';

export interface VaultDocumentRecord {
  path: string;
  title: string;
  content: string;
  tags: string[];
  status: 'active' | 'archived' | 'inbox';
  kind: VaultCollectionKind;
  category?: string;
  agentId?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
}

export interface VaultReadResult extends VaultDocumentRecord {
  id: string;
}

export interface VaultSearchResult {
  filePath: string;
  heading: string;
  excerpt: string;
  score: number;
  status: VaultDocumentRecord['status'];
  kind: VaultCollectionKind;
  updatedAt: string;
}

export interface VaultSearchResponse {
  results: VaultSearchResult[];
  mode: VaultSearchMode;
  semanticSearchAvailable: boolean;
}

export interface VaultWriteInput {
  path: string;
  content: string;
  title?: string;
  tags?: string[];
  category?: string;
  kind?: VaultCollectionKind;
  status?: VaultDocumentRecord['status'];
  agentId?: string;
  metadata?: Record<string, unknown>;
}

export interface VaultListItem {
  name: string;
  path: string;
  isDir: boolean;
  status?: VaultDocumentRecord['status'];
  updatedAt?: string;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (content == null) return '';
  if (typeof content === 'object') {
    try {
      return JSON.stringify(content, null, 2);
    } catch {
      return String(content);
    }
  }
  return String(content);
}

function extractTitle(content: string, fallbackPath: string): string {
  const heading = content.match(/^#\s+(.+)$/m)?.[1]?.trim();
  if (heading) return heading;
  const pathSegments = fallbackPath.split('/');
  const last = pathSegments[pathSegments.length - 1] ?? fallbackPath;
  return last.replace(/\.md$/i, '');
}

export function normalizeVaultPath(inputPath: string): string {
  let path = inputPath.trim();
  path = path.replace(/^\/?(vault)\//, '');
  path = path.replace(/^\//, '');
  if (!path) throw new Error('vault path cannot be empty');
  if (path.includes('..')) throw new Error(`vault path traversal blocked: ${inputPath}`);
  return path;
}

function candidatePaths(inputPath: string): string[] {
  const normalized = normalizeVaultPath(inputPath);
  if (normalized.endsWith('.md')) {
    return [normalized];
  }
  return [normalized, `${normalized}.md`];
}

function inferKind(path: string, explicitKind?: VaultCollectionKind): VaultCollectionKind {
  if (explicitKind) return explicitKind;
  if (
    path.startsWith('scratchpads/') ||
    path.startsWith('99-scratchpads/') ||
    path.startsWith('tmp/') ||
    path.startsWith('coordination/')
  ) {
    return 'scratchpad';
  }
  return 'document';
}

function buildPrefixRegex(prefix?: string): RegExp {
  const normalized = prefix ? normalizeVaultPath(prefix).replace(/\/$/, '') : '';
  return normalized.length > 0
    ? new RegExp(`^${escapeRegex(normalized)}(?:/|$)`, 'i')
    : /.*/i;
}

function buildSearchRegex(query: string): RegExp {
  return new RegExp(escapeRegex(query.trim()), 'i');
}

function summarizeExcerpt(content: string, query: string): string {
  const clean = content.replace(/\s+/g, ' ').trim();
  const lower = clean.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const idx = lower.indexOf(lowerQuery);
  if (idx === -1) {
    return clean.slice(0, 200);
  }
  const start = Math.max(0, idx - 60);
  const end = Math.min(clean.length, idx + Math.max(lowerQuery.length, 40) + 80);
  return clean.slice(start, end);
}

function scoreDocument(doc: VaultDocumentRecord, query: string): number {
  const lowerQuery = query.toLowerCase();
  let score = 0;
  if (doc.path.toLowerCase().includes(lowerQuery)) score += 4;
  if (doc.title.toLowerCase().includes(lowerQuery)) score += 6;
  if (doc.tags.some((tag) => tag.toLowerCase().includes(lowerQuery))) score += 3;
  if (doc.content.toLowerCase().includes(lowerQuery)) score += 2;
  if (doc.status === 'inbox') score += 0.5;
  return score;
}

export class VaultStore {
  private readonly documents: Collection<VaultDocumentRecord>;
  private readonly scratchpads: Collection<VaultDocumentRecord>;

  constructor(private readonly db: Db) {
    this.documents = db.collection<VaultDocumentRecord>(VAULT_DOCUMENTS_COLLECTION);
    this.scratchpads = db.collection<VaultDocumentRecord>(VAULT_SCRATCHPADS_COLLECTION);
  }

  async initialize(): Promise<void> {
    await Promise.all([
      this.documents.createIndex({ path: 1 }, { unique: true }),
      this.documents.createIndex({ status: 1, updatedAt: -1 }),
      this.documents.createIndex({ updatedAt: -1 }),
      this.documents.createIndex({ title: 'text', content: 'text', tags: 'text', path: 'text' }),
      this.scratchpads.createIndex({ path: 1 }, { unique: true }),
      this.scratchpads.createIndex({ status: 1, updatedAt: -1 }),
      this.scratchpads.createIndex({ updatedAt: -1 }),
      this.scratchpads.createIndex({ title: 'text', content: 'text', tags: 'text', path: 'text' }),
    ]);
  }

  async read(path: string): Promise<VaultReadResult | null> {
    const paths = candidatePaths(path);
    for (const collection of [this.documents, this.scratchpads]) {
      const doc = await collection.findOne({ path: { $in: paths } });
      if (doc) {
        const id = typeof doc._id === 'object' && doc._id !== null && 'toString' in doc._id
          ? doc._id.toString()
          : String(doc._id);
        return {
          ...this.stripId(doc),
          id,
        };
      }
    }
    return null;
  }

  async write(input: VaultWriteInput): Promise<VaultReadResult> {
    const path = normalizeVaultPath(input.path);
    const kind = inferKind(path, input.kind);
    const collection = this.getCollection(kind);
    const otherCollection = kind === 'scratchpad' ? this.documents : this.scratchpads;
    const now = new Date().toISOString();
    const existing = await collection.findOne({ path });
    const content = normalizeContent(input.content);

    const record: VaultDocumentRecord = {
      path,
      title: input.title?.trim() || extractTitle(content, path),
      content,
      tags: Array.isArray(input.tags) ? input.tags.filter(Boolean) : [],
      status: input.status ?? existing?.status ?? 'active',
      kind,
      category: input.category ?? existing?.category,
      agentId: input.agentId ?? existing?.agentId,
      metadata: input.metadata ?? existing?.metadata,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      archivedAt: input.status === 'archived' ? now : existing?.archivedAt,
    };

    await collection.updateOne(
      { path },
      { $set: record },
      { upsert: true },
    );
    await otherCollection.deleteMany({ path });

    return {
      ...(await this.read(path))!,
    };
  }

  async archive(path: string): Promise<VaultReadResult | null> {
    const normalized = normalizeVaultPath(path);
    for (const collection of [this.documents, this.scratchpads]) {
      const result = await collection.findOneAndUpdate(
        { path: { $in: candidatePaths(normalized) } },
        {
          $set: {
            status: 'archived',
            archivedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        },
        { returnDocument: 'after' },
      );
      if (result) {
        return this.read(normalized);
      }
    }
    return null;
  }

  async list(prefix?: string): Promise<VaultListItem[]> {
    const regex = buildPrefixRegex(prefix);
    const base = prefix ? normalizeVaultPath(prefix).replace(/\/$/, '') : '';
    const docs = await this.fetchMany(
      { path: regex, status: { $ne: 'archived' } },
      { limit: 2000 },
    );

    const items = new Map<string, VaultListItem>();
    for (const doc of docs) {
      const relative = base.length > 0 && doc.path.startsWith(`${base}/`)
        ? doc.path.slice(base.length + 1)
        : base.length === 0
          ? doc.path
          : doc.path === base
            ? ''
            : doc.path;

      if (relative.length === 0) continue;
      const [head, ...rest] = relative.split('/');
      const childPath = base.length > 0 ? `${base}/${head}` : head;
      const existing = items.get(childPath);
      if (rest.length > 0) {
        if (!existing) {
          items.set(childPath, { name: head, path: childPath, isDir: true });
        }
        continue;
      }

      items.set(childPath, {
        name: head,
        path: childPath,
        isDir: false,
        status: doc.status,
        updatedAt: doc.updatedAt,
      });
    }

    return [...items.values()].sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }

  async search(query: string, limit = 10, mode: VaultSearchMode = 'text'): Promise<VaultSearchResponse> {
    if (mode === 'semantic') {
      return {
        results: [],
        mode,
        semanticSearchAvailable: false,
      };
    }

    const regex = buildSearchRegex(query);
    const docs = await this.fetchMany(
      {
        status: { $ne: 'archived' },
        $or: [
          { path: regex },
          { title: regex },
          { content: regex },
          { tags: regex },
        ],
      },
      { limit: Math.max(limit * 4, 25) },
    );

    const ranked = docs
      .map((doc) => ({
        filePath: doc.path,
        heading: doc.title,
        excerpt: summarizeExcerpt(doc.content, query),
        score: scoreDocument(doc, query),
        status: doc.status,
        kind: doc.kind,
        updatedAt: doc.updatedAt,
      }))
      .filter((doc) => doc.score > 0)
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return b.updatedAt.localeCompare(a.updatedAt);
      })
      .slice(0, limit);

    return {
      results: ranked,
      mode,
      semanticSearchAvailable: false,
    };
  }

  async listInbox(limit = 100): Promise<VaultReadResult[]> {
    const docs = await this.fetchMany(
      {
        $or: [
          { status: 'inbox' },
          { path: /^05-inbox\//i },
        ],
      },
      { limit },
    );

    return docs
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((doc) => ({
        ...doc,
        id: doc._id.toString(),
      }));
  }

  private getCollection(kind: VaultCollectionKind): Collection<VaultDocumentRecord> {
    return kind === 'scratchpad' ? this.scratchpads : this.documents;
  }

  private async fetchMany(
    filter: Filter<VaultDocumentRecord>,
    options?: { limit?: number },
  ): Promise<Array<WithId<VaultDocumentRecord>>> {
    const [documents, scratchpads] = await Promise.all([
      this.documents.find(filter).limit(options?.limit ?? 100).toArray(),
      this.scratchpads.find(filter).limit(options?.limit ?? 100).toArray(),
    ]);
    return [...documents, ...scratchpads];
  }

  private stripId(doc: WithId<VaultDocumentRecord>): VaultDocumentRecord {
    const { _id: _ignored, ...rest } = doc;
    return rest;
  }
}
