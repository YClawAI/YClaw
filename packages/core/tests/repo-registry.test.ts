import { describe, it, expect, vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { Db } from 'mongodb';
import { RepoRegistry } from '../src/config/repo-registry.js';
import { RepoConfigSchema } from '../src/config/repo-schema.js';
import { RepoExecutor } from '../src/actions/repo.js';
import { ACTION_SCHEMAS } from '../src/actions/schemas.js';
import { validateAllConfigs } from '../src/config/loader.js';

const REPO_ROOT = resolve(import.meta.dirname, '..', '..', '..');
const REPOS_DIR = join(REPO_ROOT, 'repos');

function externalRepoConfig(overrides: Record<string, unknown> = {}) {
  return {
    name: 'external-app',
    github: {
      owner: 'ExampleOrg',
      repo: 'External-App',
      default_branch: 'main',
      branch_prefix: 'agent/',
    },
    tech_stack: {
      language: 'typescript',
      framework: 'next',
      package_manager: 'npm',
      build_command: 'npm run build',
      test_command: 'npm test',
      lint_command: 'npm run lint',
    },
    risk_tier: 'auto',
    trust_level: 'sandboxed',
    deployment: { type: 'none' },
    codegen: {
      preferred_backend: 'codex',
      timeout_minutes: 15,
      max_workspace_mb: 250,
      claude_md_path: 'CLAUDE.md',
    },
    secrets: {
      codegen_secrets: [],
      deploy_secrets: [],
      github_token_scope: 'contents_rw',
    },
    metadata: {
      description: 'External test application',
      primary_reviewers: [],
    },
    ...overrides,
  };
}

function fakeDb() {
  const docs: Record<string, unknown>[] = [];
  const collection = {
    find: vi.fn(() => ({ toArray: vi.fn(async () => docs) })),
    updateOne: vi.fn(async (filter: any, update: any) => {
      const index = docs.findIndex(doc => doc.name === filter.name);
      const next = update.$set as Record<string, unknown>;
      if (index === -1) {
        docs.push(next);
      } else {
        docs[index] = { ...docs[index], ...next };
      }
      return { acknowledged: true, matchedCount: index === -1 ? 0 : 1, modifiedCount: 1 };
    }),
    deleteOne: vi.fn(async (filter: any) => {
      const index = docs.findIndex(doc => doc.name === filter.name);
      if (index !== -1) docs.splice(index, 1);
      return { acknowledged: true, deletedCount: index === -1 ? 0 : 1 };
    }),
  };
  const db = {
    collection: vi.fn(() => collection),
  } as unknown as Db;
  return { db, collection, docs };
}

describe('static repo configs', () => {
  it('all repos/*.yaml files parse against RepoConfigSchema', () => {
    const files = readdirSync(REPOS_DIR).filter(file => file.endsWith('.yaml'));

    const failures = files.flatMap(file => {
      const parsed = parseYaml(readFileSync(join(REPOS_DIR, file), 'utf-8'));
      const result = RepoConfigSchema.safeParse(parsed);
      return result.success
        ? []
        : [`${file}: ${result.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; ')}`];
    });

    expect(failures).toEqual([]);
  });
});

describe('RepoRegistry dynamic registration', () => {
  it('resolves registered repos by case-insensitive GitHub full_name', async () => {
    const registry = new RepoRegistry();
    await registry.initialize();

    await registry.register(externalRepoConfig());

    expect(registry.has('exampleorg/external-app')).toBe(true);
    expect(registry.get('exampleorg/external-app')?.name).toBe('external-app');
    expect(registry.getByFullName('exampleorg/external-app')?.name).toBe('external-app');
  });

  it('cleans stale full_name aliases when re-registering a repo name', async () => {
    const registry = new RepoRegistry();
    await registry.initialize();

    await registry.register(externalRepoConfig({
      github: {
        owner: 'ExampleOrg',
        repo: 'old-target',
        default_branch: 'main',
        branch_prefix: 'agent/',
      },
    }));
    await registry.register(externalRepoConfig({
      github: {
        owner: 'ExampleOrg',
        repo: 'new-target',
        default_branch: 'main',
        branch_prefix: 'agent/',
      },
    }));

    expect(registry.getByFullName('ExampleOrg/old-target')).toBeUndefined();
    expect(registry.getByFullName('ExampleOrg/new-target')?.name).toBe('external-app');
  });

  it('unregisters a dynamic repo from memory and MongoDB', async () => {
    const { db, collection } = fakeDb();
    const registry = new RepoRegistry();
    await registry.initialize(db);
    await registry.register(externalRepoConfig());

    const result = await registry.unregister('exampleorg/external-app');

    expect(result.removed).toBe(true);
    expect(collection.deleteOne).toHaveBeenCalledWith({ name: 'external-app' });
    expect(registry.has('external-app')).toBe(false);
    expect(registry.has('ExampleOrg/External-App')).toBe(false);
  });
});

describe('RepoExecutor tool surface', () => {
  it('allows Architect to call dynamic repo registration tools and documents the workflow', () => {
    const { valid } = validateAllConfigs();
    const architect = valid.find(config => config.name === 'architect');
    const reference = readFileSync(
      join(REPO_ROOT, 'prompts', 'architect-workflow-reference.md'),
      'utf-8',
    );

    expect(architect?.actions).toEqual(
      expect.arrayContaining(['repo:list', 'repo:register', 'repo:unregister']),
    );
    expect(reference).toContain('repo:register');
    expect(reference).toContain('repo:unregister');
  });

  it('exposes typed register and unregister action schemas to agents', () => {
    expect(ACTION_SCHEMAS['repo:register']).toBeDefined();
    expect(ACTION_SCHEMAS['repo:register'].parameters.name.required).toBe(true);
    expect(ACTION_SCHEMAS['repo:unregister']).toBeDefined();
    expect(ACTION_SCHEMAS['repo:unregister'].parameters.repo.required).toBe(true);
  });

  it('executes repo:unregister through the action executor', async () => {
    const registry = new RepoRegistry();
    await registry.initialize();
    await registry.register(externalRepoConfig());

    const executor = new RepoExecutor(registry);
    const result = await executor.execute('unregister', {
      repo: 'ExampleOrg/External-App',
    });

    expect(result.success).toBe(true);
    expect(result.data?.removed).toBe(true);
    expect(registry.has('external-app')).toBe(false);
  });
});
