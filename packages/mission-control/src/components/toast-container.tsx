'use client';

import { useToastStore } from '@/stores/toast-store';

const BORDER_COLORS: Record<string, string> = {
  success: 'border-l-mc-success',
  error: 'border-l-mc-danger',
  info: 'border-l-mc-info',
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
          className={`bg-mc-bg/95 backdrop-blur-sm border border-mc-border border-l-2 ${BORDER_COLORS[toast.type] ?? 'border-l-mc-border'} rounded-panel px-4 py-3 shadow-lg animate-in slide-in-from-right`}
        >
          <div className="flex items-start gap-2">
            <span className="font-sans text-xs text-mc-text flex-1">
              {toast.message}
            </span>
            <button
              onClick={() => remove(toast.id)}
              className="text-mc-text-tertiary hover:text-mc-text text-xs shrink-0 transition-colors duration-mc ease-mc-out"
            >
              &times;
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
