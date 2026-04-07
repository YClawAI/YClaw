import { GlobalSettingsContent } from '@/components/global-settings-content';

export default function SettingsPage() {
  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-lg font-bold text-terminal-text tracking-wide">Settings</h1>
      </div>
      <GlobalSettingsContent />
    </div>
  );
}
