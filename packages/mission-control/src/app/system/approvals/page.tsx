export const dynamic = 'force-dynamic';

import { getApprovals, type ApprovalItem } from '@/lib/approvals-queries';
import { StatusBadge } from '@/components/status-badge';
import { ApproveButton } from '@/components/approve-button';
import { RefreshTrigger } from '@/components/refresh-trigger';
import fs from 'fs';
import path from 'path';

interface VaultProposal {
  filename: string;
  title: string;
  preview: string;
}

function getVaultProposals(): VaultProposal[] {
  const vaultPath = process.env.VAULT_PATH ?? path.join(process.cwd(), '../../vault/05-inbox');
  try {
    if (!fs.existsSync(vaultPath)) return [];
    const files = fs.readdirSync(vaultPath).filter((f) => f.endsWith('.md'));
    return files.map((filename) => {
      const content = fs.readFileSync(path.join(vaultPath, filename), 'utf-8');
      const titleMatch = content.match(/^#\s+(.+)/m);
      const title = titleMatch?.[1] ?? filename.replace('.md', '');
      const preview = content.replace(/^#.*/gm, '').trim().slice(0, 200);
      return { filename, title, preview };
    });
  } catch {
    return [];
  }
}

export default async function ApprovalsPage() {
  const [approvals, vaultProposals] = await Promise.all([
    getApprovals('pending'),
    Promise.resolve(getVaultProposals()),
  ]);

  return (
    <div>
      <RefreshTrigger />
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-lg font-bold text-mc-text tracking-wide">Approvals</h1>
        <span className="text-sm text-mc-text-tertiary font-mono">
          {approvals.length + vaultProposals.length} pending
        </span>
      </div>

      <section className="mb-8">
        <h2 className="text-xs font-bold uppercase tracking-widest text-mc-blocked mb-3">
          Deploy Approvals ({approvals.length})
        </h2>
        {approvals.length === 0 ? (
          <div className="text-mc-text-tertiary text-sm py-3 px-4 border border-mc-border/50 rounded bg-mc-surface-hover/30">
            No pending approvals.
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {approvals.map((a: ApprovalItem) => (
              <div key={a.id} className="border border-mc-border rounded p-4 bg-mc-surface-hover">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-bold text-mc-text">{a.title || a.id}</span>
                      <StatusBadge status={a.status} />
                    </div>
                    {a.agentId && <span className="text-xs text-mc-accent font-mono">{a.agentId}</span>}
                    {a.repo && (
                      <span className="text-xs text-mc-text-tertiary font-mono ml-2">
                        {a.repo}{a.prNumber ? ` #${a.prNumber}` : ''}
                      </span>
                    )}
                    {a.description && <p className="text-sm text-mc-text-tertiary mt-2 line-clamp-2">{a.description}</p>}
                    {a.createdAt && <p className="text-xs text-mc-text-tertiary mt-1">{new Date(a.createdAt).toLocaleString()}</p>}
                  </div>
                  <ApproveButton approvalId={a.id} />
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        {/* Pre-flip used terminal-purple for the section header + terminal-cyan
            for agent IDs/filenames; mechanical flip collapsed both to mc-accent.
            Route the header purple -> mc-dept-finance so the header stays
            visually distinct from the agent-id/filename labels. */}
        <h2 className="text-xs font-bold uppercase tracking-widest text-mc-dept-finance mb-3">
          Vault Proposals ({vaultProposals.length})
        </h2>
        {vaultProposals.length === 0 ? (
          <div className="text-mc-text-tertiary text-sm py-3 px-4 border border-mc-border/50 rounded bg-mc-surface-hover/30">
            No vault proposals found.
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {vaultProposals.map((p) => (
              <div key={p.filename} className="border border-mc-border rounded p-4 bg-mc-surface-hover">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="font-bold text-mc-text mb-1">{p.title}</div>
                    <p className="text-xs text-mc-accent font-mono mb-2">vault/05-inbox/{p.filename}</p>
                    <p className="text-sm text-mc-text-tertiary line-clamp-3">{p.preview}</p>
                  </div>
                  <a
                    href={`/system/vault/05-inbox/${p.filename.replace('.md', '')}`}
                    className="text-xs text-mc-info hover:underline font-mono whitespace-nowrap"
                  >
                    View →
                  </a>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
