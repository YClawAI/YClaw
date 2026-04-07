'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { useChatStore } from '@/stores/chat-store';
import { ChatPanel } from './chat-panel';

const PAGE_CONTEXTS: Record<string, string> = {
  '/departments/finance': 'User is viewing the Finance department dashboard.',
  '/departments/executive': 'User is viewing the Executive department dashboard.',
  '/departments/development': 'User is viewing the Development department dashboard.',
  '/departments/marketing': 'User is viewing the Marketing department dashboard.',
  '/departments/operations': 'User is viewing the Operations department dashboard.',
  '/departments/support': 'User is viewing the Support department dashboard.',
  '/openclaw': 'User is on the OpenClaw orchestrator page.',
  '/system/queues': 'User is viewing the Task Queue.',
  '/system/approvals': 'User is viewing pending approvals.',
  '/events': 'User is viewing the live event stream.',
  '/settings': 'User is viewing global settings.',
};

export function ChatDrawer() {
  const open = useChatStore((s) => s.open);
  const setOpen = useChatStore((s) => s.setOpen);
  const messages = useChatStore((s) => s.messages);
  const clearMessages = useChatStore((s) => s.clearMessages);
  const pathname = usePathname();

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, setOpen]);

  const contextEntry = Object.entries(PAGE_CONTEXTS).find(([path]) =>
    pathname.startsWith(path),
  );
  const pageContext = contextEntry?.[1] ?? `User is viewing ${pathname}`;

  return (
    <aside
      className={`shrink-0 border-l border-terminal-border bg-terminal-surface flex flex-col transition-all duration-200 overflow-hidden ${
        open ? 'w-[380px]' : 'w-0 border-l-0'
      }`}
    >
      <div className="flex flex-col h-full">
        <div className="px-4 py-3 border-b border-terminal-border flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-sm">🚀</span>
            <span className="text-xs font-bold text-terminal-purple font-mono">OpenClaw</span>
            <span className="text-[10px] text-terminal-dim font-mono">&mdash; Chat</span>
          </div>
          <div className="flex items-center gap-2">
            {messages.length > 0 && (
              <button
                onClick={clearMessages}
                className="text-[10px] text-terminal-dim hover:text-terminal-red transition-colors"
              >
                Clear
              </button>
            )}
            <button
              onClick={() => setOpen(false)}
              className="text-terminal-dim hover:text-terminal-text transition-colors text-lg leading-none"
            >
              &times;
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-hidden">
          <ChatPanel embedded pageContext={pageContext} />
        </div>
      </div>
    </aside>
  );
}
