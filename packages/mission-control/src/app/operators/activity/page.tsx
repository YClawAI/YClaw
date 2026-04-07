export const dynamic = 'force-dynamic';

import { getOperatorActivity } from '@/lib/operators-api';
import { ActivityClient } from './client';

export default async function OperatorActivityPage() {
  const activity = await getOperatorActivity();

  return (
    <ActivityClient
      initialActivity={activity}
      initialError={activity === null ? 'Failed to load operator activity' : undefined}
    />
  );
}
