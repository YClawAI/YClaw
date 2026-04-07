export const dynamic = 'force-dynamic';

import { getLocks } from '@/lib/operators-api';
import { LocksClient } from './client';

export default async function LocksPage() {
  const data = await getLocks();

  return (
    <LocksClient
      initialLocks={data?.locks}
      initialNote={data?.note}
    />
  );
}
