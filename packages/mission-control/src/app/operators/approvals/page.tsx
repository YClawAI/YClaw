export const dynamic = 'force-dynamic';

import { getCrossDeptApprovals } from '@/lib/operators-api';
import { ApprovalsClient } from './client';

export default async function ApprovalsPage() {
  const data = await getCrossDeptApprovals();

  return <ApprovalsClient initialData={data ?? undefined} />;
}
