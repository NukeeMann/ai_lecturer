import { NextResponse } from 'next/server';
import { promises as fs } from 'node:fs';
import { z } from 'zod';
import { LessonSchema } from '@/lib/schemas/lesson';
import { selectConnector } from '@/lib/lessonChat/connector';
import { buildPromptContext } from '@/lib/lessonChat/context';
import { InvalidSlugError, lessonFile } from '@/lib/server/paths';

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

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request', issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const { courseSlug, lessonSlug, sectionId, message, history } = parsed.data;

  let file: string;
  try {
    file = lessonFile(courseSlug, lessonSlug);
  } catch (err) {
    if (err instanceof InvalidSlugError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }

  let lessonRaw: string;
  try {
    lessonRaw = await fs.readFile(file, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return NextResponse.json({ error: 'Lesson not found' }, { status: 404 });
    }
    throw err;
  }

  let lessonJson: unknown;
  try {
    lessonJson = JSON.parse(lessonRaw);
  } catch (err) {
    return NextResponse.json(
      { error: 'Stored lesson is not valid JSON', detail: String(err) },
      { status: 500 },
    );
  }

  const lessonParsed = LessonSchema.safeParse(lessonJson);
  if (!lessonParsed.success) {
    return NextResponse.json(
      {
        error: 'Stored lesson failed schema validation',
        issues: lessonParsed.error.issues,
      },
      { status: 500 },
    );
  }

  const { systemPrompt, contextBlock } = buildPromptContext({
    lesson: lessonParsed.data,
    currentSectionId: sectionId,
  });
  const userMessage = `${contextBlock}\n\nUser question: ${message}`;

  const connector = await selectConnector();
  if (!connector) {
    return NextResponse.json(UNAVAILABLE_BODY, { status: 503 });
  }

  try {
    const assistant = await connector.chat({
      systemPrompt,
      userMessage,
      history,
    });
    return NextResponse.json({ assistant });
  } catch (err) {
    console.error('[lesson-chat] connector failed', err);
    return NextResponse.json(
      { error: `AI Tutor error: ${(err as Error).message}` },
      { status: 502 },
    );
  }
}
