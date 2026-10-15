import { NextResponse } from 'next/server';
import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { LessonSchema, type Lesson } from '@/lib/schemas/lesson';
import {
  selectConnector,
  type ChatStreamEvent,
  type Connector,
  type ConnectorRequest,
  type ImageAttachment,
} from '@/lib/lessonChat/connector';
import { buildPromptContext } from '@/lib/lessonChat/context';
import { LIVE_STATE_REQUEST_MAX_CHARS } from '@/lib/lessonChat/liveState';
import { MEDIA_FILE_RE, readMediaFile } from '@/lib/lessonChat/media';
import { tutorAgentOptions } from '@/lib/lessonChat/tutorAgent';
import { InvalidSlugError, lessonFile } from '@/lib/server/paths';
import {
  registerInflight,
  unregisterInflight,
} from '@/lib/lessonChat/inflight';

export const dynamic = 'force-dynamic';

/** Images per message the composer allows (keep in sync with LessonChat). */
const MAX_IMAGES_PER_MESSAGE = 4;
/** Images per prompt: the current message's plus the most recent earlier
 *  ones, so follow-ups ("and in the lower channels?") still see them. */
const MAX_PROMPT_IMAGES = 6;

const MediaFileSchema = z.string().regex(MEDIA_FILE_RE);

const ChatMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string(),
  images: z.array(MediaFileSchema).max(MAX_IMAGES_PER_MESSAGE).optional(),
});

const RequestSchema = z
  .object({
    courseSlug: z.string().min(1),
    lessonSlug: z.string().min(1),
    sectionId: z.string().optional(),
    message: z.string(),
    images: z.array(MediaFileSchema).max(MAX_IMAGES_PER_MESSAGE).optional(),
    history: z.array(ChatMessageSchema).optional(),
    /** Live state the widget in `sectionId` published via the TutorBridge.
     *  Learner-generated: the prompt builder truncates it and labels it as data. */
    widgetState: z.string().max(LIVE_STATE_REQUEST_MAX_CHARS).optional(),
  })
  .refine((d) => d.message.trim().length > 0 || (d.images?.length ?? 0) > 0, {
    message: 'message or images required',
    path: ['message'],
  });

type HistoryItem = z.infer<typeof ChatMessageSchema>;

const UNAVAILABLE_BODY = {
  error: 'AI Tutor unavailable: install Claude Code CLI or sign in to Claude Max.',
};

interface ResolvedRequest {
  courseSlug: string;
  lessonSlug: string;
  sectionId?: string;
  message: string;
  images?: string[];
  history?: HistoryItem[];
  widgetState?: string;
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

  const { courseSlug, lessonSlug, sectionId, message, images, history, widgetState } =
    parsed.data;

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
      images,
      history,
      widgetState,
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

class MissingImageError extends Error {}

/**
 * Load the learner's images for the prompt: every image of the current
 * message, then earlier ones newest-first up to MAX_PROMPT_IMAGES. Earlier
 * messages get an inline marker ("[Attached images: E1]") matching the label
 * in front of each image block, so the model can tell which is which.
 */
async function loadPromptImages(
  current: string[],
  history: HistoryItem[],
): Promise<{ attachments: ImageAttachment[]; history: ChatMessageForPrompt[] }> {
  const attachments: ImageAttachment[] = [];
  const load = async (file: string, label: string) => {
    const media = await readMediaFile(file);
    if (!media) throw new MissingImageError(file);
    attachments.push({ mediaType: media.mediaType, data: media.bytes.toString('base64'), label });
  };

  for (let i = 0; i < current.length; i++) {
    await load(current[i], `Image ${i + 1} attached by the learner to the current question:`);
  }

  const outHistory: ChatMessageForPrompt[] = history.map((m) => ({ role: m.role, content: m.content }));
  let earlier = 0;
  for (let h = history.length - 1; h >= 0; h--) {
    const files = history[h].images ?? [];
    if (files.length === 0) continue;
    const tags: string[] = [];
    let dropped = 0;
    for (const file of files) {
      if (attachments.length >= MAX_PROMPT_IMAGES) {
        dropped += 1;
        continue;
      }
      earlier += 1;
      const tag = `E${earlier}`;
      tags.push(tag);
      try {
        await load(file, `Earlier image ${tag} (attached by the learner to an earlier message):`);
      } catch (err) {
        // An earlier image that vanished from the store shouldn't block the
        // follow-up question — only the current message's images must exist.
        if (!(err instanceof MissingImageError)) throw err;
        tags.pop();
        dropped += 1;
      }
    }
    const notes: string[] = [];
    if (tags.length > 0) notes.push(`[Attached images: ${tags.join(', ')} — shown below]`);
    if (dropped > 0) notes.push(`[${dropped} attached image(s) not included this turn]`);
    outHistory[h] = { ...outHistory[h], content: `${outHistory[h].content}\n${notes.join(' ')}`.trim() };
  }
  return { attachments, history: outHistory };
}

type ChatMessageForPrompt = { role: 'user' | 'assistant'; content: string };

export async function POST(req: Request) {
  const resolved = await resolveRequest(req);
  if (!resolved.ok) return resolved.response;

  const { sectionId, message, images, history, widgetState, lesson } = resolved.data;

  let prompt: Awaited<ReturnType<typeof loadPromptImages>>;
  try {
    prompt = await loadPromptImages(images ?? [], history ?? []);
  } catch (err) {
    if (err instanceof MissingImageError) {
      return NextResponse.json(
        { error: 'Attached image not found — attach it again.' },
        { status: 400 },
      );
    }
    throw err;
  }

  const agent = tutorAgentOptions();
  if (agent.cwd) await fs.mkdir(agent.cwd, { recursive: true });

  const { systemPrompt, contextBlock } = buildPromptContext({
    lesson,
    currentSectionId: sectionId,
    activeWidgetState: widgetState,
    research: agent.mcpServers !== undefined,
    learnerImages: prompt.attachments.length > 0,
  });
  const question =
    message.trim().length > 0
      ? message
      : '(The learner sent only the attached image(s), without a comment. Describe what they show and relate it to the lesson.)';
  const userMessage = `${contextBlock}\n\nUser question: ${question}`;
  const connectorReq: ConnectorRequest = {
    systemPrompt,
    userMessage,
    history: history === undefined ? undefined : prompt.history,
    images: prompt.attachments,
    ...agent,
  };

  const connector = await selectConnector();
  if (!connector) {
    return NextResponse.json(UNAVAILABLE_BODY, { status: 503 });
  }

  if (wantsEventStream(req)) {
    return streamResponse(connector, connectorReq);
  }

  try {
    const assistant = await connector.chat(connectorReq);
    return NextResponse.json({ assistant });
  } catch (err) {
    console.error('[lesson-chat] connector failed', err);
    return NextResponse.json(
      { error: `AI Tutor error: ${(err as Error).message}` },
      { status: 502 },
    );
  }
}

function streamResponse(connector: Connector, args: ConnectorRequest): Response {
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
          } else if (ev.type === 'interim') {
            controller.enqueue(sseEncode('interim', {}));
          } else if (ev.type === 'activity') {
            controller.enqueue(sseEncode('activity', ev.activity));
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
