import { GlobalSettingsContent } from '@/components/global-settings-content';

export default function SettingsPage() {
  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="font-sans text-lg font-medium uppercase tracking-label text-mc-text">Settings</h1>
      </div>
      <GlobalSettingsContent />
    </div>
  );
}
