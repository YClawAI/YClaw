/**
 * Pi Model Factory — thin wrapper around pi-ai's getModel().
 * This is the ONLY file that imports from @mariozechner/pi-ai.
 */

import { getModel } from '@mariozechner/pi-ai';

/**
 * Create a pi-ai Model for use with createAgentSession().
 * Maps YClaw provider names to pi-ai provider names if needed.
 */
export function createPiModel(
  provider: string,
  modelId: string,
): ReturnType<typeof getModel> {
  const piProvider = mapProvider(provider);
  return getModel(piProvider as any, modelId as any);
}

function mapProvider(provider: string): string {
  const map: Record<string, string> = {
    anthropic: 'anthropic',
    openai: 'openai',
    google: 'google',
    xai: 'xai',
  };
  return map[provider] ?? provider;
}
