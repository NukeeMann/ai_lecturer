import { NextResponse } from 'next/server';
import {
  getRunById,
  readEventsLogSync,
  type GenerationEvent,
} from '@/lib/server/generation';

export const dynamic = 'force-dynamic';

// US-138: each emitted SSE chunk now carries an `id: <seq>` line so the
// browser's EventSource populates `Last-Event-ID` automatically on
// reconnect. The `event:` + `data:` lines preserve the previous framing
// so existing clients (the wizard log panel) keep working unchanged.
function sseFrame(seq: number, event: GenerationEvent): Uint8Array {
  return new TextEncoder().encode(
    `id: ${seq}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
  );
}

/**
 * Resolve the "replay everything after this seq" cursor. The standard
 * `Last-Event-ID` header (sent automatically by EventSource on reconnect)
 * takes precedence over the `?from=` query parameter so manual reconnects
 * via `new EventSource(...?from=N)` are still honoured but a real reconnect
 * with both present always wins on the header.
 */
function parseFromSeq(req: Request): number {
  const header = req.headers.get('Last-Event-ID');
  let raw: string | null = header;
  if (raw === null) {
    raw = new URL(req.url).searchParams.get('from');
  }
  if (raw === null) return 0;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

export async function GET(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const run = getRunById(id);
  if (!run) {
    return NextResponse.json({ error: 'Unknown generation id' }, { status: 404 });
  }
  const fromSeq = parseFromSeq(req);

  let unsubscribe: (() => void) | null = null;
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const safeEnqueue = (seq: number, event: GenerationEvent) => {
        if (closed) return;
        try {
          controller.enqueue(sseFrame(seq, event));
        } catch {
          /* controller already closed */
        }
      };

      // US-138 race-free replay:
      //   1. Snapshot run.events.length AFTER opening the stream but BEFORE
      //      the ndjson read so we know how many in-memory events were
      //      already present at this instant. Sync from here onward — Node
      //      is single-threaded so no emit() can interleave.
      //   2. Synchronously read the active ndjson and replay every entry
      //      with seq > fromSeq.
      //   3. Backstop walk: any event in run.events[0..snapshotLen) whose
      //      seq is greater than the last replayed seq must be flushed
      //      from memory — it was emitted but its append hadn't been
      //      observed by readFileSync (small partial-line race window).
      //   4. THEN attach the live listener so further emits stream through.
      const snapshotLen = run.events.length;

      const replay = readEventsLogSync(run.slug, fromSeq);
      let lastReplayedSeq = fromSeq;
      for (const entry of replay.entries) {
        safeEnqueue(entry.seq, entry.event);
        if (entry.seq > lastReplayedSeq) lastReplayedSeq = entry.seq;
      }
      if (replay.skippedMalformed > 0) {
        // Production never sees this if the process exits cleanly — only a
        // crash mid-append leaves a truncated trailing line behind.
        console.warn(
          `[gen] skipped ${replay.skippedMalformed} malformed lines in events log`,
        );
      }

      const seqs = run.eventSeqs;
      for (let i = 0; i < snapshotLen; i++) {
        const seq = seqs[i] ?? 0;
        if (seq > lastReplayedSeq) {
          safeEnqueue(seq, run.events[i]);
          lastReplayedSeq = seq;
        }
      }

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

      if (run.finished) {
        closed = true;
        try {
          controller.close();
        } catch {
          /* already closed */
        }
        return;
      }

      unsubscribe = run.subscribe((event, seq) => {
        // Dedupe: an in-memory event whose ndjson line was already replayed
        // (seq <= lastReplayedSeq) must not be sent twice. Any new emit
        // assigns a strictly greater seq, so this only matters for the
        // narrow handoff between replay and listener attach.
        if (seq <= lastReplayedSeq) return;
        lastReplayedSeq = seq;
        safeEnqueue(seq, event);
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
