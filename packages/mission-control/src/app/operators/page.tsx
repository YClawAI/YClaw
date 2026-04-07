export const dynamic = 'force-dynamic';

import { getOperators } from '@/lib/operators-api';
import { OperatorsClient } from './client';

export default async function OperatorsPage() {
  const { operators, error } = await getOperators();

  // Provide a more actionable error message when the core API returns 404
  // (the /v1/operators endpoint may not exist yet in this environment).
  const displayError = error?.includes('404')
    ? 'Operators API endpoint not found (HTTP 404). The /v1/operators route may not be deployed yet.'
    : error;

  return <OperatorsClient initialOperators={operators} initialError={displayError} />;
}
