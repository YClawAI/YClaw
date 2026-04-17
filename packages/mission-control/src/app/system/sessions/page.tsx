export const dynamic = 'force-dynamic';

import { RefreshTrigger } from '@/components/refresh-trigger';

export default function SessionsPage() {
  return (
    <div>
      <RefreshTrigger />
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-lg font-bold text-mc-text tracking-wide">Sessions</h1>
      </div>

      <div className="text-mc-text-tertiary text-sm py-6 text-center">
        No active sessions.
      </div>
    </div>
  );
}
