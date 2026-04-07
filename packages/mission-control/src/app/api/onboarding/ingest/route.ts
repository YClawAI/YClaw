export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { fetchCoreApi } from '@/lib/core-api';
import { requireSession, checkTier } from '@/lib/require-permission';

/** POST: Ingest asset — file upload, URL, or GitHub repo. */
export async function POST(req: NextRequest) {
  const auth = await requireSession();
  if (auth.error) return auth.error;
  const denied = checkTier(auth.session, 'root');
  if (denied) return denied;

  const type = req.nextUrl.searchParams.get('type');

  if (type === 'url') {
    const body = await req.json();
    const result = await fetchCoreApi<unknown>('/v1/onboarding/ingest/url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status || 502 });
    }
    return NextResponse.json(result.data);
  }

  if (type === 'github') {
    const body = await req.json();
    const result = await fetchCoreApi<unknown>('/v1/onboarding/ingest/github', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status || 502 });
    }
    return NextResponse.json(result.data);
  }

  // Default: file upload — forward multipart data
  // For file uploads, the core API handles multer parsing.
  // MC receives the FormData and proxies the raw body.
  const formData = await req.formData();
  const file = formData.get('file') as File | null;
  const sessionId = formData.get('sessionId') as string | null;

  if (!file || !sessionId) {
    return NextResponse.json({ error: 'file and sessionId required' }, { status: 400 });
  }

  // Read file into buffer and forward as JSON with base64 content
  const buffer = Buffer.from(await file.arrayBuffer());
  const result = await fetchCoreApi<unknown>('/v1/onboarding/ingest', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionId,
      filename: file.name,
      mimetype: file.type || 'application/octet-stream',
      content: buffer.toString('base64'),
      size: file.size,
    }),
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status || 502 });
  }
  return NextResponse.json(result.data);
}
