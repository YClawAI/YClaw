'use client';

import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import { useCallback, useEffect, type ReactNode } from 'react';

interface Tab {
  key: string;
  label: string;
}

interface TabLayoutProps {
  tabs: Tab[];
  children: Record<string, ReactNode>;
  defaultTab?: string;
}

export function TabLayout({ tabs, children, defaultTab }: TabLayoutProps) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const rawTab = searchParams.get('tab');
  const fallbackTab = defaultTab ?? tabs[0]?.key ?? '';
  const activeTab = rawTab && tabs.some(t => t.key === rawTab) ? rawTab : fallbackTab;

  // Correct the URL when an invalid ?tab= value is present
  useEffect(() => {
    if (rawTab && rawTab !== activeTab) {
      const params = new URLSearchParams(searchParams.toString());
      if (activeTab === fallbackTab) {
        params.delete('tab');
      } else {
        params.set('tab', activeTab);
      }
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname);
    }
  }, [rawTab, activeTab, fallbackTab, searchParams, router, pathname]);

  const setTab = useCallback(
    (key: string) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set('tab', key);
      router.push(`${pathname}?${params.toString()}`);
    },
    [searchParams, router, pathname],
  );

  return (
    <div>
      <div className="flex gap-1 mb-6 border-b border-terminal-border">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setTab(tab.key)}
            className={`px-4 py-2 text-xs font-mono transition-colors border-b-2 -mb-px ${
              activeTab === tab.key
                ? 'text-terminal-text border-terminal-purple'
                : 'text-terminal-dim border-transparent hover:text-terminal-text'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div>{children[activeTab] ?? children[tabs[0]?.key ?? '']}</div>
    </div>
  );
}
