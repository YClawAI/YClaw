import { NextRequest } from 'next/server';
import { Redis } from 'ioredis';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Sanitize a Redis message for SSE data framing — escape newlines */
function sanitizeSSEData(message: string): string {
  return message.replace(/\n/g, '\\n').replace(/\r/g, '\\r');
}

export async function GET(req: NextRequest) {
  const encoder = new TextEncoder();
  let subscriber: Redis | null = null;

  let pingInterval: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(`event: ping\ndata: {}\n\n`));

      const redisUrl = process.env.REDIS_URL;
      if (!redisUrl) return;

      subscriber = new Redis(redisUrl, {
        maxRetriesPerRequest: 3,
        retryStrategy: (times) => Math.min(times * 100, 3000),
      });

      subscriber.subscribe('audit:events', (err) => {
        if (err) console.error('[audit/stream] Redis subscribe error:', err);
      });

      subscriber.on('message', (_channel: string, message: string) => {
        try {
          const safeData = sanitizeSSEData(message);
          controller.enqueue(
            encoder.encode(`event: audit:event\ndata: ${safeData}\n\n`)
          );
        } catch { /* skip */ }
      });

      // Keepalive every 15s
      pingInterval = setInterval(() => {
        try { controller.enqueue(encoder.encode(`event: ping\ndata: {}\n\n`)); }
        catch { if (pingInterval) clearInterval(pingInterval); }
      }, 15_000);

      req.signal.addEventListener('abort', () => {
        if (pingInterval) { clearInterval(pingInterval); pingInterval = null; }
        subscriber?.unsubscribe();
        subscriber?.quit();
        subscriber = null;
      });
    },
    cancel() {
      if (pingInterval) { clearInterval(pingInterval); pingInterval = null; }
      subscriber?.unsubscribe();
      subscriber?.quit();
      subscriber = null;
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
