import { getGateway } from './gateway-ws';
import type {
  GatewayStatus,
  ChannelStatus,
  SessionInfo,
  CronJob,
  CronStatus,
  SkillInfo,
  GatewayConfig,
  HealthSnapshot,
  ModelInfo,
} from '@/types/gateway';

// Re-export types for consumers
export type {
  GatewayStatus,
  ChannelStatus,
  SessionInfo,
  CronJob,
  CronStatus,
  SkillInfo,
  GatewayConfig,
  HealthSnapshot,
  ModelInfo,
};

const BASE_URL = process.env.OPENCLAW_URL || '';
const TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN || '';

// ── Helpers ──────────────────────────────────────────────────────

/** Safely coerce a value to an array — handles object-maps, arrays, null */
function toArray<T>(val: unknown): T[] {
  if (Array.isArray(val)) return val;
  if (val && typeof val === 'object' && !Array.isArray(val)) return Object.values(val) as T[];
  return [];
}

// ── Reads (Server Components) ───────────────────────────────────

/**
 * Read a lightweight health snapshot from the gateway RPC layer.
 * Mission Control uses this on the layout shell and OpenClaw dashboard.
 */
export async function getGatewayHealth(): Promise<GatewayStatus | null> {
  try {
    // 'status' RPC returns a rich object — map to our flat GatewayStatus
    const raw = await getGateway().invoke<Record<string, unknown>>('status');
    if (!raw) return null;

    // Also fetch health for version/uptime
    const health = await getGateway().invoke<Record<string, unknown>>('health').catch(() => null);

    const sessions = raw.sessions as Record<string, unknown> | undefined;
    return {
      version: (health as Record<string, unknown>)?.version as string || '',
      model: (sessions?.defaults as Record<string, unknown>)?.model as string || '',
      uptime: '',
      sessions: (sessions?.count as number) ?? 0,
      contextTokens: 0,
      totalTokens: 0,
      thinkMode: '',
      elevated: false,
    };
  } catch {
    return null;
  }
}

/**
 * Return current channel connectivity from the gateway RPC `channels.status`
 * method, normalizing object-map payloads into a simple array for the UI.
 */
export async function getChannels(): Promise<ChannelStatus[]> {
  try {
    const result = await getGateway().invoke<Record<string, unknown>>('channels.status');
    // channels.status returns { channels: { slack: {...}, signal: {...} } } — object keyed by provider
    const channelsRaw = result?.channels;
    if (!channelsRaw) return [];

    if (Array.isArray(channelsRaw)) return channelsRaw;

    // Convert object-map to array
    return Object.entries(channelsRaw as Record<string, Record<string, unknown>>).map(([provider, ch]) => ({
      provider,
      accountId: ch.accountId as string | undefined,
      connected: (ch.running as boolean) ?? false,
      error: ch.lastError as string | undefined,
      lastMessageAt: ch.lastMessageAt as number | undefined,
      stats: ch.stats as { sent: number; received: number } | undefined,
    }));
  } catch {
    return [];
  }
}

/**
 * Return the current OpenClaw session inventory exposed by the gateway.
 */
export async function getSessions(): Promise<SessionInfo[]> {
  try {
    const result = await getGateway().invoke<Record<string, unknown>>('sessions.list');
    return toArray<SessionInfo>(result?.sessions);
  } catch {
    return [];
  }
}

/**
 * Return the configured cron jobs currently known to the gateway.
 */
export async function getCronJobs(): Promise<CronJob[]> {
  try {
    const result = await getGateway().invoke<Record<string, unknown>>('cron.list');
    return toArray<CronJob>(result?.jobs);
  } catch {
    return [];
  }
}

export async function getCronStatus(): Promise<CronStatus | null> {
  try {
    const raw = await getGateway().invoke<Record<string, unknown>>('cron.status');
    if (!raw) return null;
    return {
      running: (raw.enabled as boolean) ?? false,
      jobCount: (raw.jobs as number) ?? 0,
      nextRun: raw.nextWakeAtMs ? new Date(raw.nextWakeAtMs as number).toISOString() : undefined,
    };
  } catch {
    return null;
  }
}

export async function getSkills(): Promise<SkillInfo[]> {
  try {
    const result = await getGateway().invoke<Record<string, unknown>>('skills.status');
    const raw = toArray<Record<string, unknown>>(result?.skills);
    return raw.map((s) => ({
      name: s.name as string,
      enabled: !s.disabled && (s.eligible as boolean ?? true),
      hasApiKey: false,
      hasBinary: !(s.missing as Record<string, unknown[]>)?.bins?.length,
      description: s.description as string | undefined,
      disabled: s.disabled as boolean | undefined,
      eligible: s.eligible as boolean | undefined,
      source: s.source as string | undefined,
      bundled: s.bundled as boolean | undefined,
      emoji: s.emoji as string | undefined,
      skillKey: s.skillKey as string | undefined,
    }));
  } catch {
    return [];
  }
}

export async function getGatewayConfig(): Promise<GatewayConfig | null> {
  try {
    return await getGateway().invoke<GatewayConfig>('config.get');
  } catch {
    return null;
  }
}

export async function getHealth(): Promise<HealthSnapshot | null> {
  try {
    return await getGateway().invoke<HealthSnapshot>('health');
  } catch {
    return null;
  }
}

export async function getModels(): Promise<ModelInfo[]> {
  try {
    const result = await getGateway().invoke<Record<string, unknown>>('models.list');
    const raw = toArray<Record<string, unknown>>(result?.models);
    return raw.map((m) => ({
      id: m.id as string,
      provider: m.provider as string,
      alias: m.name as string | undefined,
      available: true, // If it's in the list, it's available
      name: m.name as string | undefined,
      contextWindow: m.contextWindow as number | undefined,
      reasoning: m.reasoning as boolean | undefined,
    }));
  } catch {
    return [];
  }
}

// ── Writes (Server Actions) ─────────────────────────────────────

export async function runCronJob(jobId: string): Promise<boolean> {
  try {
    await getGateway().invoke('cron.run', { jobId });
    return true;
  } catch {
    return false;
  }
}

export async function toggleCronJob(jobId: string, enabled: boolean): Promise<boolean> {
  try {
    await getGateway().invoke('cron.enable', { jobId, enabled });
    return true;
  } catch {
    return false;
  }
}

export async function patchSession(sessionKey: string, patch: Record<string, unknown>): Promise<boolean> {
  try {
    await getGateway().invoke('sessions.patch', { sessionKey, ...patch });
    return true;
  } catch {
    return false;
  }
}

export async function patchConfig(fields: Record<string, unknown>, baseHash?: string): Promise<boolean> {
  try {
    await getGateway().invoke('config.set', { ...fields, _baseHash: baseHash });
    return true;
  } catch {
    return false;
  }
}

export async function applyConfig(note: string): Promise<boolean> {
  try {
    await getGateway().invoke('config.apply', { note });
    return true;
  } catch {
    return false;
  }
}

export async function restartGateway(reason: string): Promise<boolean> {
  try {
    await getGateway().invoke('config.apply', { restart: true, note: reason });
    return true;
  } catch {
    return false;
  }
}

export async function toggleSkill(name: string, enabled: boolean): Promise<boolean> {
  try {
    await getGateway().invoke('skills.toggle', { name, enabled });
    return true;
  } catch {
    return false;
  }
}

// ── Chat (keep HTTP for streaming compatibility) ─────────────────

/**
 * Build multimodal content blocks for a message with optional images.
 */
function buildContent(
  message: string,
  images?: string[],
): string | Array<{ type: string; text?: string; image_url?: { url: string } }> {
  if (!images || images.length === 0) return message;

  const content: Array<{ type: string; text?: string; image_url?: { url: string } }> = [];

  for (const dataUrl of images.slice(0, 4)) {
    if (dataUrl.startsWith('data:image/')) {
      content.push({
        type: 'image_url',
        image_url: { url: dataUrl },
      });
    }
  }

  content.push({ type: 'text', text: message });
  return content;
}

/**
 * Send a chat message via OpenAI-compatible endpoint.
 */
export async function sendMessage(message: string, images?: string[], history?: Array<{ role: string; content: string }>): Promise<{ reply: string } | null> {
  if (!TOKEN) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const messages: Array<{ role: string; content: unknown }> = [];
    if (history && history.length > 0) {
      for (const h of history) {
        messages.push({ role: h.role, content: h.content });
      }
    }
    messages.push({ role: 'user', content: buildContent(message, images) });
    const res = await fetch(`${BASE_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${TOKEN}`,
        'x-openclaw-agent-id': 'main',
      },
      body: JSON.stringify({
        model: 'openclaw:main',
        messages,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) {
      console.error('[openclaw] sendMessage HTTP', res.status);
      return null;
    }
    const data = await res.json();
    const reply = data.choices?.[0]?.message?.content;
    return reply ? { reply } : null;
  } catch (err) {
    clearTimeout(timeout);
    console.error('[openclaw] sendMessage failed:', err instanceof Error ? err.message : err);
    return null;
  }
}

export async function sendMessageStream(message: string, images?: string[], history?: Array<{ role: string; content: string }>): Promise<ReadableStream | null> {
  if (!TOKEN) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);
  try {
    const messages: Array<{ role: string; content: unknown }> = [];
    if (history && history.length > 0) {
      for (const h of history) {
        messages.push({ role: h.role, content: h.content });
      }
    }
    messages.push({ role: 'user', content: buildContent(message, images) });
    const res = await fetch(`${BASE_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${TOKEN}`,
        'x-openclaw-agent-id': 'main',
      },
      body: JSON.stringify({
        model: 'openclaw:main',
        stream: true,
        messages,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) {
      console.error('[openclaw] sendMessageStream HTTP', res.status);
      return null;
    }
    return res.body;
  } catch (err) {
    clearTimeout(timeout);
    console.error('[openclaw] sendMessageStream failed:', err instanceof Error ? err.message : err);
    return null;
  }
}
