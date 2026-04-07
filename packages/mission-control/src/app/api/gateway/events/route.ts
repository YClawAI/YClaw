import { getGateway } from '@/lib/gateway-ws';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const encoder = new TextEncoder();
  const gateway = getGateway();

  const handlers: Array<{ event: string; handler: (p: unknown) => void }> = [];

  const stream = new ReadableStream({
    start(controller) {
      function onEvent(event: string, payload: unknown) {
        const data = JSON.stringify({ event, payload });
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${data}\n\n`));
      }

      const events = ['channels.status', 'sessions.updated', 'status', 'reconnected'];
      for (const evt of events) {
        const handler = (p: unknown) => onEvent(evt, p);
        handlers.push({ event: evt, handler });
        gateway.on(evt, handler);
      }

      // Send initial connection event
      controller.enqueue(encoder.encode(`event: connected\ndata: {}\n\n`));

      // Keepalive every 15s
      const keepalive = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: keepalive\n\n`));
        } catch {
          clearInterval(keepalive);
        }
      }, 15000);

      // Cleanup handler (called when stream is cancelled)
      return () => {
        clearInterval(keepalive);
        for (const { event, handler } of handlers) {
          gateway.off(event, handler);
        }
      };
    },
    cancel() {
      for (const { event, handler } of handlers) {
        gateway.off(event, handler);
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
