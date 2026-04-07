export const dynamic = 'force-dynamic';

import { Suspense } from 'react';
import { DeptHeader } from '@/components/dept-header';
import { RefreshTrigger } from '@/components/refresh-trigger';
import { getTreasuryData } from '@/lib/treasury-data';
import { getAttentionItems } from '@/lib/attention-engine';
import { TreasuryClient } from '@/app/treasury/client';

export default async function FinancePage() {
  const data = await getTreasuryData();
  const attentionItems = getAttentionItems(data);

  return (
    <div>
      <RefreshTrigger />
      <DeptHeader department="finance" />
      <Suspense>
        <TreasuryClient data={data} attentionItems={attentionItems} />
      </Suspense>
    </div>
  );
}
