import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// Hoist mocks before any imports that might pull in the real modules
vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}));

import { mkdir, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { WriteGateway } from '../src/knowledge/write-gateway.js';
import type { ProposalInput, WriteGatewayConfig } from '../src/knowledge/write-gateway.js';
import type { MemoryWriteScanner, ScanResult } from '../src/security/memory-scanner.js';
import type { EventBusLike } from '../src/security/memory-scanner.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeMockScanner(result: ScanResult): MemoryWriteScanner {
  return { scan: vi.fn().mockReturnValue(result) } as unknown as MemoryWriteScanner;
}

function makeMockEventBus(): EventBusLike {
  return { publish: vi.fn().mockResolvedValue(undefined) };
}

const baseConfig: WriteGatewayConfig = {
  vaultBasePath: '/repo/vault',
  gitEnabled: false,
};

const cleanScan: ScanResult = { blocked: false, issues: [] };
const blockedScan: ScanResult = { blocked: true, issues: ['Prompt injection: ignore all previous instructions'] };

const basicInput: ProposalInput = {
  content: '# Hello\n\nSome content here.',
  template: 'note',
  metadata: { agentName: 'builder', title: 'Hello World', tags: ['agent/builder'] },
};

// ─── Suite 1: Feature flag disabled ──────────────────────────────────────────

describe('WriteGateway — FF disabled', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env['FF_OBSIDIAN_GATEWAY'];
  });

  afterEach(() => {
    delete process.env['FF_OBSIDIAN_GATEWAY'];
  });

  it('returns no-op result when FF_OBSIDIAN_GATEWAY is not set', async () => {
    const scanner = makeMockScanner(cleanScan);
    const gateway = new WriteGateway(baseConfig, scanner);

    const result = await gateway.propose(basicInput);

    expect(result.blocked).toBe(false);
    expect(result.id).toBe('');
    expect(result.filePath).toBe('');
    expect(result.issues).toEqual([]);
  });

  it('returns no-op result when FF_OBSIDIAN_GATEWAY is "false"', async () => {
    process.env['FF_OBSIDIAN_GATEWAY'] = 'false';
    const scanner = makeMockScanner(cleanScan);
    const gateway = new WriteGateway(baseConfig, scanner);

    const result = await gateway.propose(basicInput);

    expect(result.id).toBe('');
    expect(result.filePath).toBe('');
  });

  it('does not call mkdir or writeFile when FF is disabled', async () => {
    const scanner = makeMockScanner(cleanScan);
    const gateway = new WriteGateway(baseConfig, scanner);

    await gateway.propose(basicInput);

    expect(mkdir).not.toHaveBeenCalled();
    expect(writeFile).not.toHaveBeenCalled();
  });

  it('does not emit any event when FF is disabled', async () => {
    const scanner = makeMockScanner(cleanScan);
    const eventBus = makeMockEventBus();
    const gateway = new WriteGateway(baseConfig, scanner, eventBus);

    await gateway.propose(basicInput);

    expect(eventBus.publish).not.toHaveBeenCalled();
  });

  it('does not call scanner.scan when FF is disabled', async () => {
    const scanner = makeMockScanner(cleanScan);
    const gateway = new WriteGateway(baseConfig, scanner);

    await gateway.propose(basicInput);

    expect(scanner.scan).not.toHaveBeenCalled();
  });
});

// ─── Suite 2: Scanner blocks dangerous write ──────────────────────────────────

describe('WriteGateway — scanner blocks dangerous write', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env['FF_OBSIDIAN_GATEWAY'] = 'true';
  });

  afterEach(() => {
    delete process.env['FF_OBSIDIAN_GATEWAY'];
  });

  it('returns blocked: true when scanner blocks', async () => {
    const scanner = makeMockScanner(blockedScan);
    const gateway = new WriteGateway(baseConfig, scanner);

    const result = await gateway.propose(basicInput);

    expect(result.blocked).toBe(true);
  });

  it('returns the scanner issues in the result', async () => {
    const scanner = makeMockScanner(blockedScan);
    const gateway = new WriteGateway(baseConfig, scanner);

    const result = await gateway.propose(basicInput);

    expect(result.issues).toEqual(['Prompt injection: ignore all previous instructions']);
  });

  it('does not write any file when scanner blocks', async () => {
    const scanner = makeMockScanner(blockedScan);
    const gateway = new WriteGateway(baseConfig, scanner);

    await gateway.propose(basicInput);

    expect(writeFile).not.toHaveBeenCalled();
    expect(mkdir).not.toHaveBeenCalled();
  });

  it('does not invoke git when scanner blocks', async () => {
    const scanner = makeMockScanner(blockedScan);
    const gateway = new WriteGateway({ ...baseConfig, gitEnabled: true }, scanner);

    await gateway.propose(basicInput);

    expect(execFile).not.toHaveBeenCalled();
  });

  it('does not emit vault:proposal_created when scanner blocks', async () => {
    const scanner = makeMockScanner(blockedScan);
    const eventBus = makeMockEventBus();
    const gateway = new WriteGateway(baseConfig, scanner, eventBus);

    await gateway.propose(basicInput);

    expect(eventBus.publish).not.toHaveBeenCalled();
  });

  it('calls scanner.scan with the correct context', async () => {
    const scanner = makeMockScanner(blockedScan);
    const gateway = new WriteGateway(baseConfig, scanner);

    await gateway.propose(basicInput);

    expect(scanner.scan).toHaveBeenCalledWith(basicInput.content, {
      agentName: 'builder',
      key: 'note',
      operation: 'knowledge_propose',
    });
  });

  it('returns empty filePath and id on block', async () => {
    const scanner = makeMockScanner(blockedScan);
    const gateway = new WriteGateway(baseConfig, scanner);

    const result = await gateway.propose(basicInput);

    expect(result.filePath).toBe('');
    expect(result.id).toBe('');
  });
});

// ─── Suite 3: Successful write ────────────────────────────────────────────────

describe('WriteGateway — successful write', () => {
  let scanner: MemoryWriteScanner;
  let eventBus: EventBusLike;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env['FF_OBSIDIAN_GATEWAY'] = 'true';
    scanner = makeMockScanner(cleanScan);
    eventBus = makeMockEventBus();

    // Default execFile mock: call the callback with no error
    vi.mocked(execFile).mockImplementation(
      ((_file: string, _args: string[], cb?: (err: Error | null) => void) => {
        cb?.(null);
        return {} as ReturnType<typeof execFile>;
      }) as unknown as typeof execFile,
    );
  });

  afterEach(() => {
    delete process.env['FF_OBSIDIAN_GATEWAY'];
  });

  it('returns blocked: false on success', async () => {
    const gateway = new WriteGateway(baseConfig, scanner, eventBus);
    const result = await gateway.propose(basicInput);
    expect(result.blocked).toBe(false);
  });

  it('returns a non-empty id on success', async () => {
    const gateway = new WriteGateway(baseConfig, scanner, eventBus);
    const result = await gateway.propose(basicInput);
    expect(result.id).toBeTruthy();
    expect(result.id.length).toBeGreaterThan(0);
  });

  it('writes the file into 05-inbox/ directory', async () => {
    const gateway = new WriteGateway(baseConfig, scanner, eventBus);
    const result = await gateway.propose(basicInput);

    expect(result.filePath).toContain('vault/05-inbox/');
    expect(writeFile).toHaveBeenCalled();
    const callArgs = vi.mocked(writeFile).mock.calls[0];
    expect(String(callArgs?.[0])).toContain('05-inbox');
  });

  it('prefixes the file with today\'s date (YYYY-MM-DD)', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const gateway = new WriteGateway(baseConfig, scanner, eventBus);
    const result = await gateway.propose(basicInput);

    expect(result.filePath).toContain(today);
  });

  it('injects YAML front-matter at the start of the written file', async () => {
    const gateway = new WriteGateway(baseConfig, scanner, eventBus);
    await gateway.propose(basicInput);

    const writtenContent = String(vi.mocked(writeFile).mock.calls[0]?.[1]);
    expect(writtenContent).toMatch(/^---\n/);
    expect(writtenContent).toContain('title: "Hello World"');
    expect(writtenContent).toContain('author: builder');
    expect(writtenContent).toContain('status: inbox');
  });

  it('includes the original content after front-matter', async () => {
    const gateway = new WriteGateway(baseConfig, scanner, eventBus);
    await gateway.propose(basicInput);

    const writtenContent = String(vi.mocked(writeFile).mock.calls[0]?.[1]);
    expect(writtenContent).toContain(basicInput.content);
  });

  it('includes tags in front-matter', async () => {
    const gateway = new WriteGateway(baseConfig, scanner, eventBus);
    await gateway.propose({ ...basicInput, metadata: { ...basicInput.metadata, tags: ['dept/dev', 'protocol'] } });

    const writtenContent = String(vi.mocked(writeFile).mock.calls[0]?.[1]);
    expect(writtenContent).toContain('dept/dev');
    expect(writtenContent).toContain('protocol');
  });

  it('emits vault:proposal_created event on success', async () => {
    const gateway = new WriteGateway(baseConfig, scanner, eventBus);
    await gateway.propose(basicInput);

    // Allow microtasks to flush (event is async fire-and-forget)
    await Promise.resolve();

    expect(eventBus.publish).toHaveBeenCalledWith(
      'vault',
      'proposal_created',
      expect.objectContaining({ agentName: 'builder', template: 'note', title: 'Hello World' }),
    );
  });

  it('does not call git exec when gitEnabled is false', async () => {
    const gateway = new WriteGateway({ ...baseConfig, gitEnabled: false }, scanner, eventBus);
    await gateway.propose(basicInput);

    expect(execFile).not.toHaveBeenCalled();
  });

  it('calls git exec when gitEnabled is true', async () => {
    const gateway = new WriteGateway({ ...baseConfig, gitEnabled: true }, scanner, eventBus);
    await gateway.propose(basicInput);

    expect(execFile).toHaveBeenCalled();
    // First call is `git add`, second is `git commit`
    const firstCall = vi.mocked(execFile).mock.calls[0];
    expect(firstCall?.[0]).toBe('git');
    expect(firstCall?.[1]).toContain('add');
    const secondCall = vi.mocked(execFile).mock.calls[1];
    expect(secondCall?.[0]).toBe('git');
    expect(secondCall?.[1]).toContain('commit');
  });

  it('does not reject the promise when git exec errors', async () => {
    vi.mocked(execFile).mockImplementation(
      ((_file: string, _args: string[], cb?: (err: Error | null) => void) => {
        cb?.(new Error('git: not a repo'));
        return {} as ReturnType<typeof execFile>;
      }) as unknown as typeof execFile,
    );

    const gateway = new WriteGateway({ ...baseConfig, gitEnabled: true }, scanner, eventBus);

    // Must not throw
    await expect(gateway.propose(basicInput)).resolves.toMatchObject({ blocked: false });
  });

  it('creates the inbox directory with recursive: true', async () => {
    const gateway = new WriteGateway(baseConfig, scanner, eventBus);
    await gateway.propose(basicInput);

    expect(mkdir).toHaveBeenCalledWith(expect.stringContaining('05-inbox'), { recursive: true });
  });

  it('returns empty issues array on success', async () => {
    const gateway = new WriteGateway(baseConfig, scanner, eventBus);
    const result = await gateway.propose(basicInput);
    expect(result.issues).toEqual([]);
  });

  it('filePath in result matches the path passed to writeFile', async () => {
    const gateway = new WriteGateway(baseConfig, scanner, eventBus);
    const result = await gateway.propose(basicInput);

    const writtenPath = String(vi.mocked(writeFile).mock.calls[0]?.[0]);
    // result.filePath is relative (vault/05-inbox/...), written path is absolute
    expect(writtenPath).toContain(result.filePath.replace('vault/05-inbox/', ''));
  });

  it('does not emit event when no eventBus is provided', async () => {
    const gateway = new WriteGateway(baseConfig, scanner);
    // Should not throw even without eventBus
    await expect(gateway.propose(basicInput)).resolves.toMatchObject({ blocked: false });
  });

  it('slugifies the title in the filename', async () => {
    const titleInput: ProposalInput = {
      ...basicInput,
      metadata: { ...basicInput.metadata, title: 'My Great Decision!' },
    };
    const gateway = new WriteGateway(baseConfig, scanner, eventBus);
    const result = await gateway.propose(titleInput);

    expect(result.filePath).toContain('my-great-decision');
  });
});
