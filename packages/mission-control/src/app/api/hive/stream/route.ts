import type { NextRequest } from 'next/server';
import { Redis } from 'ioredis';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CHANNELS = ['hive:events', 'hive:agent-status'];

/** Sanitize a Redis message for SSE data framing — escape newlines */
function sanitizeSSEData(message: string): string {
  return message.replace(/\n/g, '\\n').replace(/\r/g, '\\r');
}

export async function GET(req: NextRequest) {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    return new Response('Redis not configured', { status: 503 });
  }

  const encoder = new TextEncoder();
  let subscriber: Redis | null = null;
  let pingInterval: NodeJS.Timeout | null = null;

  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode('event: ping\ndata: {}\n\n'));

      subscriber = new Redis(redisUrl, {
        maxRetriesPerRequest: 3,
        retryStrategy: (times) => Math.min(times * 100, 3000),
      });

      // Prevent unhandled error from crashing the route worker
      subscriber.on('error', (err) => {
        console.error('[hive/stream] Redis error:', err.message);
      });

      subscriber.subscribe(...CHANNELS, (err) => {
        if (err) console.error('[hive/stream] Redis subscribe error:', err);
      });

      subscriber.on('message', (channel: string, message: string) => {
        try {
          const eventType = channel === 'hive:events' ? 'hive:event' : 'agent:status';
          const safeData = sanitizeSSEData(message);
          controller.enqueue(
            encoder.encode(`event: ${eventType}\ndata: ${safeData}\n\n`)
          );
        } catch { /* skip */ }
      });

      // Keepalive ping every 15s
      pingInterval = setInterval(() => {
        try { controller.enqueue(encoder.encode('event: ping\ndata: {}\n\n')); }
        catch { if (pingInterval) clearInterval(pingInterval); }
      }, 15_000);

      req.signal.addEventListener('abort', () => {
        if (pingInterval) clearInterval(pingInterval);
        subscriber?.unsubscribe();
        subscriber?.quit();
        subscriber = null;
      });
    },
    cancel() {
      if (pingInterval) clearInterval(pingInterval);
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
