interface CoreApiEnvelope<T> {
  success?: boolean;
  data?: T;
  error?: string;
}

type CoreFetchInit = RequestInit & {
  next?: { revalidate?: number };
};

export interface CoreApiResult<T> {
  ok: boolean;
  status: number;
  data?: T;
  error?: string;
}

export function coreApiConfig() {
  return {
    baseUrl: process.env.YCLAW_API_URL || 'http://localhost:3000',
    apiKey: process.env.YCLAW_API_KEY || '',
  };
}

function extractError(payload: unknown, fallback: string): string {
  if (payload && typeof payload === 'object' && 'error' in payload) {
    const error = (payload as { error?: unknown }).error;
    if (typeof error === 'string' && error.length > 0) return error;
  }
  return fallback;
}

/**
 * Fetch from core API with optional operator identity forwarding.
 *
 * Pass operatorId from the verified session (obtained via requireSession())
 * to include X-Operator-Id header for audit attribution in core.
 */
export async function fetchCoreApi<T>(
  path: string,
  init?: CoreFetchInit & { operatorId?: string },
): Promise<CoreApiResult<T>> {
  const { baseUrl, apiKey } = coreApiConfig();
  const headers = new Headers(init?.headers);
  if (!headers.has('x-api-key')) headers.set('x-api-key', apiKey);
  // /v1/* endpoints require Bearer auth in addition to x-api-key
  if (path.startsWith('/v1/') && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${apiKey}`);
  }
  if (init?.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');

  // Forward operator identity for audit attribution (caller provides from verified session)
  if (init?.operatorId && !headers.has('X-Operator-Id')) {
    headers.set('X-Operator-Id', init.operatorId);
  }

  try {
    const res = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers,
    });

    const raw = await res.text().catch(() => '');
    let payload: unknown = undefined;
    if (raw) {
      try {
        payload = JSON.parse(raw);
      } catch {
        payload = raw;
      }
    }

    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        error: extractError(payload, `HTTP ${res.status}`),
      };
    }

    if (payload && typeof payload === 'object' && 'success' in payload) {
      const envelope = payload as CoreApiEnvelope<T>;
      if (envelope.success === false) {
        return {
          ok: false,
          status: res.status,
          error: envelope.error || 'Request failed',
        };
      }

      const data = (envelope.data ?? null) as T;
      if (data && typeof data === 'object' && 'error' in (data as Record<string, unknown>)) {
        return {
          ok: false,
          status: res.status,
          data,
          error: extractError(data, 'Request failed'),
        };
      }

      return {
        ok: true,
        status: res.status,
        data,
      };
    }

    if (payload && typeof payload === 'object' && 'error' in (payload as Record<string, unknown>)) {
      return {
        ok: false,
        status: res.status,
        error: extractError(payload, 'Request failed'),
      };
    }

    return {
      ok: true,
      status: res.status,
      data: payload as T,
    };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
