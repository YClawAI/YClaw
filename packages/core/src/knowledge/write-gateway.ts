import { mkdir, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { dirname, join } from 'node:path';
import type { MemoryWriteScanner } from '../security/memory-scanner.js';
import type { EventBusLike } from '../security/memory-scanner.js';
import { createLogger } from '../logging/logger.js';

const logger = createLogger('write-gateway');

export interface ProposalInput {
  content: string;
  template: 'decision' | 'project' | 'research' | 'skill-proposal' | 'daily-standup' | 'note';
  metadata: { agentName: string; title: string; tags?: string[]; [k: string]: unknown };
}

export interface ProposalResult {
  id: string;
  filePath: string;
  blocked: boolean;
  issues: string[];
}

export interface WriteGatewayConfig {
  vaultBasePath: string;
  gitEnabled?: boolean;
  gitCwd?: string;
}

function toSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50);
}

function buildId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

function buildFrontmatter(input: ProposalInput, id: string): string {
  const today = new Date().toISOString().slice(0, 10);
  const tags = (input.metadata.tags ?? []).join(', ');
  const tagsLine = tags.length > 0 ? `tags: [${tags}]` : 'tags: []';
  return [
    '---',
    `title: "${input.metadata.title.replace(/"/g, '\\"')}"`,
    `created: ${today}`,
    `updated: ${today}`,
    `author: ${input.metadata.agentName}`,
    tagsLine,
    'status: inbox',
    `proposal_id: ${id}`,
    `template: ${input.template}`,
    '---',
    '',
  ].join('\n');
}

export class WriteGateway {
  constructor(
    private cfg: WriteGatewayConfig,
    private scanner: MemoryWriteScanner,
    private eventBus?: EventBusLike,
  ) {}

  async propose(input: ProposalInput): Promise<ProposalResult> {
    // Feature flag — no-op when disabled
    if (process.env['FF_OBSIDIAN_GATEWAY'] !== 'true') {
      return { blocked: false, issues: [], filePath: '', id: '' };
    }

    // Security scan
    const scanResult = this.scanner.scan(input.content, {
      agentName: input.metadata.agentName,
      key: input.template,
      operation: 'knowledge_propose',
    });

    if (scanResult.blocked) {
      logger.warn('WriteGateway blocked proposal', {
        agentName: input.metadata.agentName,
        issues: scanResult.issues,
      });
      return { blocked: true, issues: scanResult.issues, filePath: '', id: '' };
    }

    // Build file path
    const id = buildId();
    const today = new Date().toISOString().slice(0, 10);
    const slug = toSlug(input.metadata.title);
    const filename = `${today}-${id}-${slug}.md`;
    const inboxDir = join(this.cfg.vaultBasePath, '05-inbox');
    const filePath = join(inboxDir, filename);
    const relPath = `vault/05-inbox/${filename}`;

    // Build content with front-matter
    const frontmatter = buildFrontmatter(input, id);
    const fileContent = frontmatter + input.content;

    // Write file
    await mkdir(inboxDir, { recursive: true });
    await writeFile(filePath, fileContent, 'utf8');

    logger.info('Vault proposal written', { filePath: relPath, id });

    // Git commit (fire-and-forget) — uses execFile to avoid shell injection
    if (this.cfg.gitEnabled !== false) {
      const gitCwd = this.cfg.gitCwd ?? dirname(this.cfg.vaultBasePath);
      const commitMsg = `vault: agent write ${id}`;
      execFile('git', ['-C', gitCwd, 'add', filePath], (addErr) => {
        if (addErr) {
          logger.warn('vault git add failed', { error: addErr.message, id });
          return;
        }
        execFile('git', ['-C', gitCwd, 'commit', '-m', commitMsg], (commitErr) => {
          if (commitErr) {
            logger.warn('vault git commit failed', { error: commitErr.message, id });
          }
        });
      });
    }

    // Emit event (fire-and-forget)
    if (this.eventBus) {
      void this.eventBus
        .publish('vault', 'proposal_created', {
          id,
          filePath: relPath,
          agentName: input.metadata.agentName,
          template: input.template,
          title: input.metadata.title,
        })
        .catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err);
          logger.warn('vault event emit failed', { error: msg, id });
        });
    }

    return { blocked: false, issues: [], filePath: relPath, id };
  }
}
