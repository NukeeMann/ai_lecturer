import { NextResponse } from 'next/server';
import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { LessonSchema, type Lesson } from '@/lib/schemas/lesson';
import {
  selectConnector,
  type ChatStreamEvent,
  type Connector,
} from '@/lib/lessonChat/connector';
import { buildPromptContext } from '@/lib/lessonChat/context';
import { InvalidSlugError, lessonFile } from '@/lib/server/paths';
import {
  registerInflight,
  unregisterInflight,
} from '@/lib/lessonChat/inflight';

export const dynamic = 'force-dynamic';

const ChatMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string(),
});

const RequestSchema = z.object({
  courseSlug: z.string().min(1),
  lessonSlug: z.string().min(1),
  sectionId: z.string().optional(),
  message: z.string().min(1),
  history: z.array(ChatMessageSchema).optional(),
});

const UNAVAILABLE_BODY = {
  error: 'AI Tutor unavailable: install Claude Code CLI or sign in to Claude Max.',
};

interface ResolvedRequest {
  courseSlug: string;
  lessonSlug: string;
  sectionId?: string;
  message: string;
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
  lesson: Lesson;
}

async function resolveRequest(
  req: Request,
): Promise<
  | { ok: true; data: ResolvedRequest }
  | { ok: false; response: Response }
> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }),
    };
  }

  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Invalid request', issues: parsed.error.issues },
        { status: 400 },
      ),
    };
  }

  const { courseSlug, lessonSlug, sectionId, message, history } = parsed.data;

  let file: string;
  try {
    file = lessonFile(courseSlug, lessonSlug);
  } catch (err) {
    if (err instanceof InvalidSlugError) {
      return {
        ok: false,
        response: NextResponse.json({ error: err.message }, { status: 400 }),
      };
    }
    throw err;
  }

  let lessonRaw: string;
  try {
    lessonRaw = await fs.readFile(file, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return {
        ok: false,
        response: NextResponse.json({ error: 'Lesson not found' }, { status: 404 }),
      };
    }
    throw err;
  }

  let lessonJson: unknown;
  try {
    lessonJson = JSON.parse(lessonRaw);
  } catch (err) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Stored lesson is not valid JSON', detail: String(err) },
        { status: 500 },
      ),
    };
  }

  const lessonParsed = LessonSchema.safeParse(lessonJson);
  if (!lessonParsed.success) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: 'Stored lesson failed schema validation',
          issues: lessonParsed.error.issues,
        },
        { status: 500 },
      ),
    };
  }

  return {
    ok: true,
    data: {
      courseSlug,
      lessonSlug,
      sectionId,
      message,
      history,
      lesson: lessonParsed.data,
    },
  };
}

function wantsEventStream(req: Request): boolean {
  const accept = req.headers.get('accept') ?? '';
  return accept.includes('text/event-stream');
}

function sseEncode(event: string, data: unknown): Uint8Array {
  const payload = typeof data === 'string' ? data : JSON.stringify(data);
  return new TextEncoder().encode(`event: ${event}\ndata: ${payload}\n\n`);
}

export async function POST(req: Request) {
  const resolved = await resolveRequest(req);
  if (!resolved.ok) return resolved.response;

  const { sectionId, message, history, lesson } = resolved.data;
  const { systemPrompt, contextBlock } = buildPromptContext({
    lesson,
    currentSectionId: sectionId,
  });
  const userMessage = `${contextBlock}\n\nUser question: ${message}`;

  const connector = await selectConnector();
  if (!connector) {
    return NextResponse.json(UNAVAILABLE_BODY, { status: 503 });
  }

  if (wantsEventStream(req)) {
    return streamResponse(connector, { systemPrompt, userMessage, history });
  }

  try {
    const assistant = await connector.chat({ systemPrompt, userMessage, history });
    return NextResponse.json({ assistant });
  } catch (err) {
    console.error('[lesson-chat] connector failed', err);
    return NextResponse.json(
      { error: `AI Tutor error: ${(err as Error).message}` },
      { status: 502 },
    );
  }
}

interface ConnectorCallArgs {
  systemPrompt: string;
  userMessage: string;
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
}

function streamResponse(connector: Connector, args: ConnectorCallArgs): Response {
  const requestId = randomUUID();
  const abortController = new AbortController();
  registerInflight(requestId, abortController);

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      // First event always carries the requestId so the client knows what
      // to DELETE if the user clicks Stop.
      controller.enqueue(sseEncode('meta', { requestId }));

      let iter: AsyncIterator<ChatStreamEvent> | null = null;
      try {
        const stream = connector.chatStream(args, abortController.signal);
        iter = stream[Symbol.asyncIterator]();
        while (true) {
          const next = await iter.next();
          if (next.done) break;
          const ev = next.value;
          if (ev.type === 'token') {
            controller.enqueue(sseEncode('token', { text: ev.text }));
          } else if (ev.type === 'error') {
            controller.enqueue(sseEncode('error', { message: ev.message }));
            break;
          } else if (ev.type === 'done') {
            controller.enqueue(sseEncode('done', {}));
            break;
          }
        }
        if (abortController.signal.aborted) {
          // Stream was cancelled by the user via DELETE — emit a final
          // `aborted` event so the client can finalise the bubble.
          controller.enqueue(sseEncode('aborted', {}));
        }
      } catch (err) {
        if (!abortController.signal.aborted) {
          controller.enqueue(
            sseEncode('error', { message: (err as Error).message }),
          );
        }
      } finally {
        unregisterInflight(requestId);
        try {
          controller.close();
        } catch {
          // already closed
        }
      }
    },
    cancel() {
      // Client disconnected — abort any in-flight work.
      abortController.abort();
      unregisterInflight(requestId);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
      'X-Lesson-Chat-Request-Id': requestId,
    },
  });
}
