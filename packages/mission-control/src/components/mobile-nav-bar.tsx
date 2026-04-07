'use client';

export type MobileTab = 'hive' | 'agents' | 'settings';

interface MobileNavBarProps {
  activeTab: MobileTab;
  onTabChange: (tab: MobileTab) => void;
}

const TABS: Array<{ id: MobileTab; label: string; icon: string }> = [
  { id: 'hive', label: 'Hive', icon: '\u{1F52E}' },
  { id: 'agents', label: 'Agents', icon: '\u{1F916}' },
  { id: 'settings', label: 'Settings', icon: '\u2699\uFE0F' },
];

export function MobileNavBar({ activeTab, onTabChange }: MobileNavBarProps) {
  return (
    <nav className="fixed bottom-0 inset-x-0 z-30 bg-gray-900/95 backdrop-blur border-t border-gray-800 safe-area-pb">
      <div className="flex items-center justify-around h-14">
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            className={`flex flex-col items-center gap-0.5 px-4 py-1 rounded-lg transition-colors ${
              activeTab === tab.id
                ? 'text-blue-400'
                : 'text-gray-500 active:text-gray-300'
            }`}
          >
            <span className="text-lg">{tab.icon}</span>
            <span className="text-[10px] font-medium">{tab.label}</span>
          </button>
        ))}
      </div>
    </nav>
  );
}
