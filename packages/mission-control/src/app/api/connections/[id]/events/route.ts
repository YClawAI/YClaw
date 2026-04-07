export const dynamic = 'force-dynamic';

import { getSession, DatabaseUnavailableError } from '@/lib/connections';

/**
 * GET /api/connections/[id]/events — SSE stream for real-time session updates.
 *
 * Streams step_update, session_update, and complete events to the client.
 * Polls the database every 2 seconds and emits changes. Closes automatically
 * when the session reaches a terminal state (connected, failed).
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  // Validate session exists
  try {
    const session = await getSession(id);
    if (!session) {
      return new Response('Session not found', { status: 404 });
    }
  } catch (err) {
    if (err instanceof DatabaseUnavailableError) {
      return new Response('Database unavailable', { status: 503 });
    }
    throw err;
  }

  const TERMINAL = new Set(['connected', 'failed']);
  const POLL_INTERVAL = 2000;

  const encoder = new TextEncoder();
  let closed = false;

  const stream = new ReadableStream({
    async start(controller) {
      // Track previous state to only emit changes
      let prevStatus: string | undefined;
      let prevStepJson: string | undefined;

      async function poll() {
        if (closed) return;

        try {
          const session = await getSession(id);
          if (!session || closed) return;

          const currentStepJson = JSON.stringify(
            session.steps.map((s) => ({ id: s.id, status: s.status, detail: s.detail })),
          );

          // Emit step_update if steps changed
          if (prevStepJson !== undefined && currentStepJson !== prevStepJson) {
            for (const step of session.steps) {
              const prevSteps: { id: string; status: string; detail?: string }[] =
                prevStepJson ? JSON.parse(prevStepJson) : [];
              const prev = prevSteps.find((p) => p.id === step.id);
              if (!prev || prev.status !== step.status || prev.detail !== step.detail) {
                const data = JSON.stringify({
                  stepId: step.id,
                  status: step.status,
                  detail: step.detail,
                  actor: step.actor,
                  label: step.label,
                });
                controller.enqueue(encoder.encode(`event: step_update\ndata: ${data}\n\n`));
              }
            }
          }

          // Emit session_update if status changed
          if (prevStatus !== undefined && session.status !== prevStatus) {
            const data = JSON.stringify({ status: session.status, error: session.error });
            controller.enqueue(encoder.encode(`event: session_update\ndata: ${data}\n\n`));
          }

          prevStatus = session.status;
          prevStepJson = currentStepJson;

          // Terminal state — emit complete and close
          if (TERMINAL.has(session.status)) {
            const data = JSON.stringify({
              status: session.status,
              error: session.error,
            });
            controller.enqueue(encoder.encode(`event: complete\ndata: ${data}\n\n`));
            closed = true;
            controller.close();
            return;
          }
        } catch {
          // Polling error — skip this tick
        }

        if (!closed) {
          setTimeout(poll, POLL_INTERVAL);
        }
      }

      // Send initial heartbeat
      controller.enqueue(encoder.encode(': connected\n\n'));
      poll();
    },
    cancel() {
      closed = true;
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
