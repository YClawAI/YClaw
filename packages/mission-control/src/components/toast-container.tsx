'use client';

import { useToastStore } from '@/stores/toast-store';

const BORDER_COLORS: Record<string, string> = {
  success: 'border-terminal-green',
  error: 'border-terminal-red',
  info: 'border-terminal-blue',
};

export function ToastContainer() {
  const toasts = useToastStore((s) => s.toasts);
  const remove = useToastStore((s) => s.remove);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`bg-terminal-surface border border-terminal-border border-l-2 ${BORDER_COLORS[toast.type] ?? 'border-terminal-border'} rounded px-4 py-3 shadow-lg animate-in slide-in-from-right`}
        >
          <div className="flex items-start gap-2">
            <span className="text-xs font-mono text-terminal-text flex-1">
              {toast.message}
            </span>
            <button
              onClick={() => remove(toast.id)}
              className="text-terminal-dim hover:text-terminal-text text-xs shrink-0"
            >
              &times;
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
