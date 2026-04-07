'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { decideApproval } from '@/lib/actions/approval-actions';

interface ApproveButtonProps {
  approvalId: string;
}

export function ApproveButton({ approvalId }: ApproveButtonProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handle(decision: 'approve' | 'reject') {
    startTransition(async () => {
      await decideApproval(approvalId, decision);
      router.refresh();
    });
  }

  return (
    <span className="inline-flex gap-2">
      <button
        onClick={() => handle('approve')}
        disabled={isPending}
        className="px-3 py-1 text-xs font-mono rounded border border-terminal-green/40 text-terminal-green hover:bg-terminal-green/10 disabled:opacity-40 transition-colors"
      >
        Approve
      </button>
      <button
        onClick={() => handle('reject')}
        disabled={isPending}
        className="px-3 py-1 text-xs font-mono rounded border border-terminal-red/40 text-terminal-red hover:bg-terminal-red/10 disabled:opacity-40 transition-colors"
      >
        Reject
      </button>
    </span>
  );
}
