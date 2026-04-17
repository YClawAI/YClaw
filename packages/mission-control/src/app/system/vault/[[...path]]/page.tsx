import { notFound } from 'next/navigation';
import fs from 'fs';
import path from 'path';
import { marked } from 'marked';

// Escape raw HTML in markdown to prevent XSS via dangerouslySetInnerHTML.
// Markdown formatting (headings, links, code, etc.) still works — only raw
// HTML tags embedded in the source are neutralized.
marked.use({
  renderer: {
    html(html: string) {
      return html
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    },
  },
});

function getVaultRoot(): string {
  return process.env.VAULT_PATH ?? path.join(process.cwd(), '../../vault');
}

interface DirEntry {
  name: string;
  isDir: boolean;
  path: string;
}

function readDir(dirPath: string, relBase: string): DirEntry[] {
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    return entries
      .filter((e) => !e.name.startsWith('.'))
      .map((e) => ({
        name: e.name,
        isDir: e.isDirectory(),
        path: path.join(relBase, e.name),
      }))
      .sort((a, b) => {
        if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
  } catch {
    return [];
  }
}

function readRootTree(vaultRoot: string): DirEntry[] {
  return readDir(vaultRoot, '');
}

interface VaultPageProps {
  params: { path?: string[] };
}

export default function VaultPage({ params }: VaultPageProps) {
  const vaultRoot = getVaultRoot();
  const segments = params.path ?? [];
  const fsPath = path.join(vaultRoot, ...segments);

  const resolvedPath = path.resolve(fsPath);
  const resolvedRoot = path.resolve(vaultRoot);
  if (!resolvedPath.startsWith(resolvedRoot)) {
    notFound();
  }

  const rootEntries = readRootTree(vaultRoot);
  let content: string | null = null;
  let isDir = false;
  let dirEntries: DirEntry[] = [];
  let fileExists = false;

  try {
    const stat = fs.statSync(resolvedPath);
    fileExists = true;
    if (stat.isDirectory()) {
      isDir = true;
      dirEntries = readDir(resolvedPath, segments.join('/'));
    } else {
      const raw = fs.readFileSync(resolvedPath, 'utf-8');
      content = typeof marked(raw) === 'string' ? (marked(raw) as string) : raw;
    }
  } catch {
    const mdPath = resolvedPath + '.md';
    try {
      const raw = fs.readFileSync(mdPath, 'utf-8');
      content = typeof marked(raw) === 'string' ? (marked(raw) as string) : raw;
      fileExists = true;
    } catch {
      // not found
    }
  }

  const currentPath = segments.join('/');
  const downloadHref = fileExists && !isDir && segments.length > 0 ? `/system/vault/raw/${currentPath}` : null;

  return (
    <div className="flex gap-4 h-full">
      <aside className="w-52 shrink-0 overflow-y-auto">
        <div className="text-xs font-bold uppercase tracking-widest text-mc-text-tertiary mb-3">Vault</div>
        <VaultTree entries={rootEntries} vaultRoot={vaultRoot} activePath={currentPath} depth={0} />
      </aside>

      <div className="flex-1 min-w-0">
        {!fileExists && segments.length > 0 ? (
          <div className="text-mc-danger text-sm font-mono">File not found: {currentPath}</div>
        ) : isDir ? (
          <div>
            <h2 className="text-sm font-bold text-mc-text-tertiary mb-4 font-mono">
              /{currentPath || 'vault'}
            </h2>
            <div className="flex flex-col gap-1">
              {dirEntries.map((e) => (
                <a
                  key={e.path}
                  href={`/system/vault/${e.path}`}
                  className="flex items-center gap-2 py-1.5 px-3 rounded text-sm font-mono hover:bg-mc-surface-hover text-mc-text"
                >
                  <span className="text-mc-text-tertiary">{e.isDir ? '📁' : '📄'}</span>
                  {e.name}
                </a>
              ))}
              {dirEntries.length === 0 && (
                <p className="text-mc-text-tertiary text-sm">Empty directory.</p>
              )}
            </div>
          </div>
        ) : content ? (
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between text-xs font-mono text-mc-text-tertiary">
              <span className="truncate">/{currentPath}</span>
              {downloadHref && (
                <a
                  href={downloadHref}
                  className="ml-4 shrink-0 text-mc-info hover:underline"
                >
                  Download
                </a>
              )}
            </div>
            <article
              className="prose prose-invert prose-sm max-w-none prose-headings:font-mono prose-headings:text-mc-text prose-p:text-mc-text-tertiary prose-code:text-mc-accent prose-pre:bg-mc-surface-hover prose-pre:border prose-pre:border-mc-border prose-a:text-mc-info prose-strong:text-mc-text"
              dangerouslySetInnerHTML={{ __html: content }}
            />
          </div>
        ) : (
          <p className="text-mc-text-tertiary text-sm">Select a file from the vault.</p>
        )}
      </div>
    </div>
  );
}

interface VaultTreeProps {
  entries: DirEntry[];
  vaultRoot: string;
  activePath: string;
  depth: number;
}

function VaultTree({ entries, vaultRoot, activePath, depth }: VaultTreeProps) {
  return (
    <ul className="flex flex-col gap-0.5">
      {entries.map((e) => {
        const href = e.path ? `/system/vault/${e.path}` : '/system/vault';
        const isActive = activePath === e.path || activePath.startsWith(e.path + '/');
        const childEntries = e.isDir ? readDir(path.join(vaultRoot, e.path), e.path) : [];

        return (
          <li key={e.path}>
            <a
              href={href}
              className={`flex items-center gap-1.5 py-0.5 px-2 rounded text-xs font-mono transition-colors ${
                isActive
                  ? 'text-mc-text bg-mc-border'
                  : 'text-mc-text-tertiary hover:text-mc-text hover:bg-mc-surface-hover'
              }`}
              style={{ paddingLeft: `${8 + depth * 12}px` }}
            >
              <span>{e.isDir ? '▶' : '·'}</span>
              {e.name}
            </a>
            {e.isDir && isActive && childEntries.length > 0 && (
              <VaultTree
                entries={childEntries}
                vaultRoot={vaultRoot}
                activePath={activePath}
                depth={depth + 1}
              />
            )}
          </li>
        );
      })}
    </ul>
  );
}
