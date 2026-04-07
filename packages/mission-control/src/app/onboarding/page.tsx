export const dynamic = 'force-dynamic';

import { fetchCoreApi } from '@/lib/core-api';
import { OnboardingClient } from './client';

interface OnboardingStatus {
  active: boolean;
  sessionId?: string;
  stage?: string;
  currentQuestion?: number;
  totalQuestionsInStage?: number;
  artifactCount?: number;
  approvedArtifactCount?: number;
  assetCount?: number;
  status?: string;
}

export default async function OnboardingPage() {
  let status: OnboardingStatus = { active: false };
  let error: string | undefined;

  try {
    const result = await fetchCoreApi<OnboardingStatus>('/v1/onboarding/status?orgId=default');
    if (result.ok && result.data) {
      status = result.data;
    } else if (result.status === 403 || result.status === 401) {
      error = 'Root operator access required for onboarding.';
    }
  } catch (err) {
    console.error('[onboarding] Failed to fetch initial status:', err);
  }

  return <OnboardingClient initialStatus={status} initialError={error} />;
}
