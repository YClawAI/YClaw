import { NextRequest, NextResponse } from 'next/server';
import { getGateway } from '@/lib/gateway-ws';
import { requireSession, checkTier } from '@/lib/require-permission';

/**
 * Security gate: only these RPC methods may be called through the HTTP proxy.
 * Server-side code (openclaw.ts) calls getGateway().invoke() directly and is
 * not affected by this allowlist. Any method not listed here is rejected with 403.
 *
 * To add a method: add the frontend call first, then add the method here.
 */
const ALLOWED_METHODS: ReadonlySet<string> = new Set([
  'cron.run',
  'cron.enable',
  'skills.toggle',
  'config.set',
  'config.apply',
]);

export async function POST(req: NextRequest) {
  // RPC invocation requires department_head+
  const auth = await requireSession();
  if (auth.error) return auth.error;
  const denied = checkTier(auth.session, 'department_head');
  if (denied) return denied;

  try {
    const { method, params } = await req.json();

    if (!method || typeof method !== 'string') {
      return NextResponse.json({ ok: false, error: 'method required' }, { status: 400 });
    }

    if (!ALLOWED_METHODS.has(method)) {
      console.warn(`[rpc] Blocked disallowed method: ${method}`);
      return NextResponse.json({ ok: false, error: 'method not allowed' }, { status: 403 });
    }

    if (params != null && (typeof params !== 'object' || Array.isArray(params))) {
      return NextResponse.json({ ok: false, error: 'params must be a JSON object' }, { status: 400 });
    }

    const result = await getGateway().invoke(method, params);
    return NextResponse.json({ ok: true, result });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
