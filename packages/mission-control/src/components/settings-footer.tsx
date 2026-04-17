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
    buttonStyle = 'border-mc-success/40 text-mc-success bg-mc-success/10';
  } else if (saving) {
    buttonText = 'SAVING...';
    buttonStyle = 'border-mc-border text-mc-text-tertiary cursor-not-allowed';
  } else if (disabled) {
    buttonText = disabledLabel;
    buttonStyle = 'border-mc-border text-mc-text-tertiary cursor-not-allowed';
  } else if (dirty) {
    buttonText = 'SAVE CHANGES';
    buttonStyle = 'border-mc-success/40 text-mc-success hover:bg-mc-success/10';
  } else {
    buttonText = 'SAVE CHANGES';
    buttonStyle = 'border-mc-border text-mc-text-tertiary cursor-not-allowed';
  }

  return (
    <div className="sticky bottom-0 bg-mc-bg/95 backdrop-blur-sm border-t border-mc-border px-4 py-3 flex items-center justify-between mt-6">
      <div>
        {error && (
          <span className="font-sans text-xs text-mc-danger">{error}</span>
        )}
        {dirty && !error && !saved && (
          <span className="font-sans text-xs text-mc-warning">Unsaved changes</span>
        )}
      </div>
      <button
        onClick={onSave}
        disabled={!canClick}
        className={`px-4 py-1.5 font-sans text-[11px] uppercase tracking-label rounded-panel border transition-colors duration-mc ease-mc-out ${buttonStyle}`}
      >
        {buttonText}
      </button>
    </div>
  );
}
