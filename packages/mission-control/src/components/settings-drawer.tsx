'use client';

import { useEffect } from 'react';
import { useChatStore } from '@/stores/chat-store';

const CHAT_WIDTH = 380;

interface SettingsDrawerProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}

export function SettingsDrawer({ open, onClose, title, children, footer }: SettingsDrawerProps) {
  const chatOpen = useChatStore((s) => s.open);
  const rightOffset = chatOpen ? CHAT_WIDTH : 0;

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
      return () => { document.body.style.overflow = ''; };
    }
  }, [open]);

  return (
    <>
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/40 transition-opacity"
          style={{ right: rightOffset }}
          onClick={onClose}
        />
      )}
      <div
        className={`fixed top-0 bottom-0 z-40 w-full max-w-md bg-mc-bg/95 backdrop-blur-sm border-l border-mc-border shadow-2xl flex flex-col max-sm:top-auto max-sm:left-0 max-sm:right-0 max-sm:bottom-0 max-sm:max-w-full max-sm:max-h-[80vh] max-sm:rounded-t-panel max-sm:border-t max-sm:border-l-0 transition-all duration-mc ease-mc-out ${
          open ? 'max-sm:translate-y-0' : 'translate-x-full max-sm:translate-x-0 max-sm:translate-y-full'
        }`}
        style={{
          right: open ? rightOffset : -448,
          pointerEvents: open ? 'auto' : 'none',
        }}
        aria-hidden={!open}
      >
        <div className="shrink-0 px-6 py-4 border-b border-mc-border flex items-center justify-between z-10">
          <h2 className="font-sans text-[11px] font-medium uppercase tracking-label text-mc-text-label">{title}</h2>
          <button
            onClick={onClose}
            className="text-mc-text-tertiary hover:text-mc-text transition-colors duration-mc ease-mc-out text-lg"
          >
            &times;
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-6">{children}</div>
        {footer}
      </div>
    </>
  );
}
