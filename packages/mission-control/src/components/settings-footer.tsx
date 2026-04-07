'use client';

interface SettingsFooterProps {
  onSave: () => void;
  saving: boolean;
  error: string | null;
  dirty?: boolean;
  saved?: boolean;
  disabled?: boolean;
  disabledLabel?: string;
}

export function SettingsFooter({
  onSave,
  saving,
  error,
  dirty,
  saved = false,
  disabled = false,
  disabledLabel = 'SAVE CHANGES',
}: SettingsFooterProps) {
  const canClick = dirty === true && !saving && !saved && !disabled;

  let buttonText: string;
  let buttonStyle: string;

  if (saved) {
    buttonText = 'Saved \u2713';
    buttonStyle = 'border-terminal-green/40 text-terminal-green bg-terminal-green/10';
  } else if (saving) {
    buttonText = 'SAVING...';
    buttonStyle = 'border-terminal-border text-terminal-dim cursor-not-allowed';
  } else if (disabled) {
    buttonText = disabledLabel;
    buttonStyle = 'border-terminal-border text-terminal-dim cursor-not-allowed';
  } else if (dirty) {
    buttonText = 'SAVE CHANGES';
    buttonStyle = 'border-terminal-green/40 text-terminal-green hover:bg-terminal-green/10';
  } else {
    buttonText = 'SAVE CHANGES';
    buttonStyle = 'border-terminal-border text-terminal-dim cursor-not-allowed';
  }

  return (
    <div className="sticky bottom-0 bg-terminal-surface border-t border-terminal-border px-4 py-3 flex items-center justify-between mt-6">
      <div>
        {error && (
          <span className="text-xs text-terminal-red font-mono">{error}</span>
        )}
        {dirty && !error && !saved && (
          <span className="text-xs text-terminal-yellow font-mono">Unsaved changes</span>
        )}
      </div>
      <button
        onClick={onSave}
        disabled={!canClick}
        className={`px-4 py-1.5 text-xs font-mono rounded border transition-colors ${buttonStyle}`}
      >
        {buttonText}
      </button>
    </div>
  );
}
