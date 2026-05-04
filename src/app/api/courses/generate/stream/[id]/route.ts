import { NextResponse } from 'next/server';
import { getRunById, sseEncode, type GenerationEvent } from '@/lib/server/generation';

export const dynamic = 'force-dynamic';

export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const run = getRunById(id);
  if (!run) {
    return NextResponse.json({ error: 'Unknown generation id' }, { status: 404 });
  }

  let unsubscribe: (() => void) | null = null;
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const safeEnqueue = (event: GenerationEvent) => {
        if (closed) return;
        try {
          controller.enqueue(sseEncode(event));
        } catch {
          /* controller already closed */
        }
      };

      // Replay buffered events for late subscribers, then attach.
      for (const ev of run.events) safeEnqueue(ev);

      const closeIfTerminal = (event: GenerationEvent) => {
        if (event.type === 'done' || event.type === 'error') {
          closed = true;
          unsubscribe?.();
          unsubscribe = null;
          try {
            controller.close();
          } catch {
            /* already closed */
          }
        }
      };

      // If the run already finished, close immediately after replay.
      if (run.finished) {
        closed = true;
        try {
          controller.close();
        } catch {
          /* already closed */
        }
        return;
      }

      unsubscribe = run.subscribe((event) => {
        safeEnqueue(event);
        closeIfTerminal(event);
      });
    },
    cancel() {
      closed = true;
      unsubscribe?.();
      unsubscribe = null;
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
