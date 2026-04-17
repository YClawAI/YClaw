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
      className={`shrink-0 border-l border-mc-border bg-mc-bg flex flex-col transition-all duration-mc ease-mc-out overflow-hidden ${
        open ? 'w-[380px]' : 'w-0 border-l-0'
      }`}
    >
      <div className="flex flex-col h-full">
        <div className="px-4 py-3 border-b border-mc-border flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-sm">🚀</span>
            <span className="font-sans text-[11px] font-medium uppercase tracking-label text-mc-accent">OpenClaw</span>
            <span className="font-sans text-[10px] text-mc-text-tertiary">&mdash; Chat</span>
          </div>
          <div className="flex items-center gap-2">
            {messages.length > 0 && (
              <button
                onClick={clearMessages}
                className="font-sans text-[10px] uppercase tracking-label text-mc-text-tertiary hover:text-mc-danger transition-colors duration-mc ease-mc-out"
              >
                Clear
              </button>
            )}
            <button
              onClick={() => setOpen(false)}
              className="text-mc-text-tertiary hover:text-mc-text transition-colors duration-mc ease-mc-out text-lg leading-none"
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
