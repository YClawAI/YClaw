'use client';

import { useState, useMemo } from 'react';

export type PostPerformance = {
  id: string;
  title: string;
  type?: string;
  publishedAt?: string;
};

interface PostPerformanceTableProps {
  posts: PostPerformance[];
}

type SortKey = 'title' | 'type' | 'publishedAt';
type SortDir = 'asc' | 'desc';

function formatTimeAgo(iso?: string): string {
  if (!iso) return '--';
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

function SortIcon({ active, dir }: { active: boolean; dir: SortDir }) {
  if (!active) {
    return (
      <svg className="w-3 h-3 text-terminal-dim/40 inline-block ml-1" viewBox="0 0 12 12" fill="currentColor">
        <path d="M6 2l3 4H3zM6 10l-3-4h6z" />
      </svg>
    );
  }
  return (
    <svg className="w-3 h-3 text-terminal-orange inline-block ml-1" viewBox="0 0 12 12" fill="currentColor">
      {dir === 'asc' ? <path d="M6 2l3 4H3z" /> : <path d="M6 10l-3-4h6z" />}
    </svg>
  );
}

const COLUMNS: { key: SortKey; label: string }[] = [
  { key: 'title', label: 'POST' },
  { key: 'type', label: 'TYPE' },
  { key: 'publishedAt', label: 'PUBLISHED' },
];

export function PostPerformanceTable({ posts }: PostPerformanceTableProps) {
  const [sortKey, setSortKey] = useState<SortKey>('publishedAt');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const handleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  };

  const sorted = useMemo(() => {
    const arr = [...posts];
    const dir = sortDir === 'asc' ? 1 : -1;
    arr.sort((a, b) => {
      const aVal = a[sortKey] ?? '';
      const bVal = b[sortKey] ?? '';
      return String(aVal).localeCompare(String(bVal)) * dir;
    });
    return arr;
  }, [posts, sortKey, sortDir]);

  if (posts.length === 0) {
    return (
      <div className="flex items-center justify-center py-8">
        <span className="text-xs text-terminal-dim">No post data available</span>
      </div>
    );
  }

  return (
    <div>
      <div className="text-xs font-bold uppercase tracking-widest text-terminal-dim mb-3">
        POST PERFORMANCE
      </div>

      <div className="bg-terminal-surface border border-terminal-border rounded overflow-x-auto">
        <table className="w-full min-w-[480px]">
          <thead>
            <tr className="border-b border-terminal-border">
              {COLUMNS.map((col) => (
                <th
                  key={col.key}
                  className="px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-terminal-dim cursor-pointer hover:text-terminal-text transition-colors select-none whitespace-nowrap text-left"
                  onClick={() => handleSort(col.key)}
                >
                  {col.label}
                  <SortIcon active={sortKey === col.key} dir={sortDir} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((post) => (
              <tr
                key={post.id}
                className="border-b border-terminal-border/50 hover:bg-terminal-muted/20 transition-colors"
              >
                <td className="px-3 py-2 text-xs text-terminal-text font-mono max-w-[200px] truncate" title={post.title}>
                  {post.title}
                </td>
                <td className="px-3 py-2 text-[10px] text-terminal-dim font-mono">
                  {post.type ?? '--'}
                </td>
                <td className="px-3 py-2 text-[10px] text-terminal-dim font-mono whitespace-nowrap">
                  {formatTimeAgo(post.publishedAt)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-2 text-[10px] text-terminal-dim font-mono text-center py-2">
        Connect analytics to see engagement metrics (impressions, likes, retweets, replies).
      </div>
    </div>
  );
}
