import { NextResponse } from 'next/server';
import { z } from 'zod';
import { selectConnector } from '@/lib/lessonChat/connector';

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

  const connector = await selectConnector();
  if (!connector) {
    return NextResponse.json(UNAVAILABLE_BODY, { status: 503 });
  }

  try {
    const assistant = await connector.chat({
      message: parsed.data.message,
      history: parsed.data.history,
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
