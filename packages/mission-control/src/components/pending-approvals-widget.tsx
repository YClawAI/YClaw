'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

export function PendingApprovalsWidget() {
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/operators/approvals/cross-dept');
        if (res.ok) {
          const data = await res.json();
          // Proxy returns { pending: [...], recentDecisions: [...] }
          setCount((data.pending ?? []).length);
        }
      } catch {
        // non-critical
      }
    })();
  }, []);

  if (count === null || count === 0) return null;

  return (
    <div className="border border-terminal-yellow/30 rounded-lg bg-terminal-yellow/5 px-4 py-3">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs font-mono font-bold text-terminal-yellow">
            Pending Operator Approvals
          </div>
          <div className="text-[10px] font-mono text-terminal-dim mt-0.5">
            {count} cross-department request{count !== 1 ? 's' : ''} awaiting approval
          </div>
        </div>
        <Link
          href="/operators/approvals"
          className="text-[10px] font-mono text-terminal-yellow hover:text-terminal-text transition-colors"
        >
          View All →
        </Link>
      </div>
    </div>
  );
}
