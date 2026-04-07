export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { sendMessage, sendMessageStream } from '@/lib/openclaw';
import { requireSession, checkTier } from '@/lib/require-permission';

export async function POST(req: NextRequest) {
  // Chat requires contributor+
  const auth = await requireSession();
  if (auth.error) return auth.error;
  const denied = checkTier(auth.session, 'contributor');
  if (denied) return denied;

  try {
    const body = await req.json();
    const message = body?.message;
    const images = body?.images as string[] | undefined;
    const history = body?.history as Array<{ role: string; content: string }> | undefined;
    const streaming = body?.stream === true;
    if (!message || typeof message !== 'string') {
      return NextResponse.json({ error: 'message required' }, { status: 400 });
    }

    // Validate images: must be data URLs, max 4, max 5MB each
    const validImages: string[] = [];
    if (Array.isArray(images)) {
      for (const img of images.slice(0, 4)) {
        if (typeof img === 'string' && img.startsWith('data:image/') && img.length < 7 * 1024 * 1024) {
          validImages.push(img);
        }
      }
    }

    // Validate history: must be array of { role, content } objects, max 10
    const validHistory: Array<{ role: string; content: string }> = [];
    if (Array.isArray(history)) {
      for (const h of history.slice(-10)) {
        if (h && typeof h.role === 'string' && typeof h.content === 'string') {
          validHistory.push({ role: h.role, content: h.content });
        }
      }
    }

    if (streaming) {
      const stream = await sendMessageStream(message, validImages, validHistory);
      if (!stream) {
        return NextResponse.json({ reply: '[Gateway unreachable — is OpenClaw running?]' });
      }
      return new Response(stream, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        },
      });
    }

    const result = await sendMessage(message, validImages, validHistory);
    if (!result) {
      return NextResponse.json({ reply: '[Gateway unreachable — is OpenClaw running?]' });
    }

    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ reply: '[Error processing request]' }, { status: 500 });
  }
}
