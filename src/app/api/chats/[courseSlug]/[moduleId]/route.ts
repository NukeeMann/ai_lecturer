import { NextResponse } from 'next/server';
import { ChatHistoryWriteSchema } from '@/lib/schemas/chatHistory';
import {
  readChatHistory,
  writeChatHistory,
} from '@/lib/server/chatHistory';
import { InvalidSlugError } from '@/lib/server/paths';

export const dynamic = 'force-dynamic';

type RouteCtx = {
  params: Promise<{ courseSlug: string; moduleId: string }>;
};

export async function GET(_req: Request, { params }: RouteCtx) {
  const { courseSlug, moduleId } = await params;
  try {
    const history = await readChatHistory(courseSlug, moduleId);
    return NextResponse.json(history);
  } catch (err) {
    if (err instanceof InvalidSlugError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
}

export async function PUT(req: Request, { params }: RouteCtx) {
  const { courseSlug, moduleId } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = ChatHistoryWriteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request body', issues: parsed.error.issues },
      { status: 422 },
    );
  }

  try {
    const saved = await writeChatHistory(courseSlug, moduleId, parsed.data);
    return NextResponse.json(saved);
  } catch (err) {
    if (err instanceof InvalidSlugError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
}
