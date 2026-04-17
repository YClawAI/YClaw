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
        className="px-3 py-1 text-xs font-mono rounded border border-mc-success/40 text-mc-success hover:bg-mc-success/10 disabled:opacity-40 transition-colors"
      >
        Approve
      </button>
      <button
        onClick={() => handle('reject')}
        disabled={isPending}
        className="px-3 py-1 text-xs font-mono rounded border border-mc-danger/40 text-mc-danger hover:bg-mc-danger/10 disabled:opacity-40 transition-colors"
      >
        Reject
      </button>
    </span>
  );
}
