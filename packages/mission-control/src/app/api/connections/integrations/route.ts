import { NextResponse } from 'next/server';
import { getAllIntegrations } from '@/lib/integration-registry';

/**
 * GET /api/connections/integrations
 *
 * Returns the server-merged integration registry (hardcoded + recipe overrides).
 * Client components should fetch from this endpoint instead of importing
 * getAllIntegrations() directly — the client-side import only sees hardcoded
 * fallbacks because recipe loading requires fs/yaml (Node-only).
 */
export async function GET() {
  const integrations = getAllIntegrations();
  return NextResponse.json(integrations);
}
